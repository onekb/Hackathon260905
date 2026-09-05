import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { createPublicClient, createWalletClient, formatEther, getAddress, http, keccak256, stringToHex, type Abi, type Address, type Hex } from 'viem';
import { foundry, monadTestnet } from 'viem/chains';
import type { ChainAdapter, ChainAccount, ChainOrder, LockInput, SettleInput } from './chain.js';
import { decimal, fee, units, type Quote } from './money.js';

const exec = promisify(execFile);
const artifactPath = new URL('../../contracts/out/InferenceMarket.sol/InferenceMarket.json', import.meta.url);
export const opaqueId = (id: string): Hex => keccak256(stringToHex(id));
type Prices = { input: bigint; cacheRead: bigint; cacheWrite: bigint; output: bigint };
type OnchainQuote = { prices: Prices; minReserve: bigint; version: bigint; active: boolean };
type Grant = { totalLimit: bigint; spent: bigint; locked: bigint; expiresAt: bigint; revoked: boolean };
type Order = { buyer: Address; provider: Address; modelId: Hex; reserved: bigint; charged: bigint; grantId: bigint; deadline: bigint; quoteVersion: bigint; state: number; outcome: number; prices: Prices };
type CallSender = (functionName: string, args: readonly unknown[]) => Promise<Hex>;

export type AlchemyCliRunner = (args: readonly string[], timeoutMs: number) => Promise<{ stdout: string; stderr?: string }>;
type AlchemyResult = Record<string, unknown>;
const isRecord = (value: unknown): value is AlchemyResult => !!value && typeof value === 'object' && !Array.isArray(value);
const isHash = (value: unknown): value is Hex => typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);
const isCallId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\s\x00-\x1f]/.test(value);
const failedStatus = (value: unknown) => typeof value === 'string' && ['failed', 'failure', 'reverted'].includes(value.toLowerCase());
function parseAlchemyJson(value: string | undefined): AlchemyResult | undefined {
  if (!value) return undefined;
  try { const parsed: unknown = JSON.parse(value.trim()); return isRecord(parsed) ? parsed : undefined; } catch { return undefined; }
}

/** CLI 0.24 returns a top-level txHash/callId, with operation references under error.data on failure. */
export function alchemyReference(result: unknown): { txHash?: Hex; callId?: string; status?: string } {
  if (!isRecord(result)) return {};
  const data = isRecord(result.error) && isRecord(result.error.data) ? result.error.data : result;
  return {
    ...(isHash(data.txHash) ? { txHash: data.txHash } : {}),
    ...(isCallId(data.callId) ? { callId: data.callId } : {}),
    ...(typeof data.status === 'string' ? { status: data.status } : {}),
  };
}

export function validateAlchemyCall(result: unknown, expected: { market: Address; router: Address; functionName: string }): void {
  if (!isRecord(result) || result.error) throw new Error('Alchemy did not return a successful contract-call result');
  if (result.network !== 'monad-testnet' || result.executionMode !== 'eoa-direct') throw new Error('Alchemy returned an unexpected network or execution mode');
  if (typeof result.from !== 'string' || getAddress(result.from) !== expected.router || typeof result.to !== 'string' || getAddress(result.to) !== expected.market || result.function !== expected.functionName) throw new Error('Alchemy contract-call identity does not match the configured router and market');
  if (result.status !== 'success') throw new Error('Alchemy contract call has not reported successful execution');
}

/** Delegated session signing on Monad is direct EOA execution, not Wallet API smart-wallet execution.
 * The CLI estimates gas with prepareTransactionRequest and waits for a receipt. This command has no
 * gas-limit option; passing an invented --gas flag or sponsorship option would be incorrect.
 */
export class AlchemySessionSender {
  private readonly references = new Map<string, { txHash?: Hex; callId?: string; status?: string }>();
  private readonly run: AlchemyCliRunner;
  constructor(readonly market: Address, readonly router: Address, readonly abi: Abi, options: { run?: AlchemyCliRunner; wait?: (ms: number) => Promise<void>; statusAttempts?: number } = {}) {
    this.run = options.run ?? (async (args, timeoutMs) => exec('alchemy', [...args], { timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 }));
    this.wait = options.wait ?? delay;
    this.statusAttempts = options.statusAttempts ?? 20;
  }
  private readonly wait: (ms: number) => Promise<void>;
  private readonly statusAttempts: number;
  async send(functionName: string, args: readonly unknown[], value = 0n): Promise<Hex> {
    if (value < 0n) throw new Error('Native value cannot be negative');
    const serialized = JSON.stringify(args, (_k, v) => typeof v === 'bigint' ? v.toString() : v);
    const key = `${functionName}:${serialized}:${value}`;
    // If a prior CLI invocation returned an operation reference, never submit that call a second time.
    const prior = this.references.get(key);
    if (prior) return this.resolveReference(prior);
    let result: AlchemyResult | undefined;
    try {
      const { stdout } = await this.run(['--json', '--no-interactive', '-n', 'monad-testnet', 'evm', 'contract', 'call', this.market, functionName, '--args', serialized, '--abi', JSON.stringify(this.abi), '--signer', 'session', ...(value ? ['--value', formatEther(value)] : [])], 120_000);
      result = parseAlchemyJson(stdout);
    } catch (error: unknown) {
      // Do not expose child-process messages, stdout or stderr: those can contain account/session details.
      const child = error as { stdout?: string; stderr?: string };
      result = parseAlchemyJson(child.stderr) ?? parseAlchemyJson(child.stdout);
      const reference = alchemyReference(result);
      if (failedStatus(reference.status)) throw new Error(`Alchemy reported a reverted contract call${reference.txHash ? ` (${reference.txHash})` : ''}`);
      if (reference.txHash || reference.callId) { this.references.set(key, reference); return this.resolveReference(reference); }
      throw new Error('Alchemy invocation ended without a transaction reference. Reservation status is uncertain; reconcile the chain before retrying.');
    }
    validateAlchemyCall(result, { market: this.market, router: this.router, functionName });
    const reference = alchemyReference(result);
    if (!reference.txHash && !reference.callId) throw new Error('Alchemy reported success without a transaction reference; reconcile the chain before retrying.');
    this.references.set(key, reference);
    return this.resolveReference(reference);
  }
  private async resolveReference(reference: { txHash?: Hex; callId?: string; status?: string }): Promise<Hex> {
    if (reference.txHash) return reference.txHash; // EvmChain independently checks the real receipt.
    const callId = reference.callId;
    if (!callId) throw new Error('Alchemy operation has no usable transaction reference');
    // Current Monad CLI output is direct EOA and does not need this path. Keep it for a known operation
    // reference recovered from a CLI error, without treating a callId as an EVM transaction hash.
    const expires = Date.now() + 30_000;
    for (let attempt = 0; attempt < this.statusAttempts && Date.now() < expires; attempt++) {
      let result: AlchemyResult | undefined;
      try { const { stdout } = await this.run(['--json', '--no-interactive', '-n', 'monad-testnet', 'evm', 'status', callId], Math.min(15_000, expires - Date.now())); result = parseAlchemyJson(stdout); } catch {}
      if (result && result.network !== 'monad-testnet') throw new Error('Alchemy operation status returned the wrong network');
      if (result && failedStatus(result.status)) throw new Error('Alchemy operation failed before a confirmed transaction was available');
      if (result && isHash(result.txHash)) { reference.txHash = result.txHash; return result.txHash; }
      if (attempt + 1 < this.statusAttempts) await this.wait(1_500);
    }
    throw new Error('Alchemy operation is still unconfirmed. The next attempt will query the same operation instead of submitting another transaction.');
  }
}

export interface EvmChainOptions {
  mode: 'anvil' | 'monad-testnet';
  rpcUrl: string;
  marketAddress: Address;
  routerAddress: Address;
  abi?: Abi;
  sender?: CallSender;
}

/** Uses actual EVM receipts. The unlocked RPC signer is accepted ONLY for local Anvil. */
export class EvmChain implements ChainAdapter {
  readonly mode: 'anvil' | 'monad-testnet';
  readonly abi: Abi;
  readonly market: Address;
  readonly router: Address;
  readonly client;
  private readonly sender: CallSender;
  private readonly hashes = new Map<string, Hex>();
  private pending: Promise<unknown> = Promise.resolve();

  constructor(options: EvmChainOptions) {
    this.mode = options.mode;
    this.abi = options.abi ?? JSON.parse(readFileSync(artifactPath, 'utf8')).abi;
    this.market = getAddress(options.marketAddress);
    this.router = getAddress(options.routerAddress);
    const chain = options.mode === 'anvil' ? foundry : monadTestnet;
    this.client = createPublicClient({ chain, transport: http(options.rpcUrl), pollingInterval: 500 });
    if (options.sender) this.sender = options.sender;
    else if (options.mode === 'anvil') {
      const hostname = new URL(options.rpcUrl).hostname;
      if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname)) throw new Error('Anvil unlocked signing requires a loopback RPC URL');
      const wallet = createWalletClient({ account: this.router, chain: foundry, transport: http(options.rpcUrl) });
      this.sender = async (functionName, args) => {
        const gas = await this.client.estimateContractGas({ address: this.market, abi: this.abi, functionName, args, account: this.router });
        return wallet.writeContract({ address: this.market, abi: this.abi, functionName, args, gas: gas + gas / 10n });
      };
    } else {
      const signer = new AlchemySessionSender(this.market, this.router, this.abi);
      this.sender = (functionName, args) => signer.send(functionName, args);
    }
  }

  async ready(): Promise<void> {
    const expected = this.mode === 'anvil' ? 31337 : 10143;
    if (await this.client.getChainId() !== expected) throw new Error(`Wrong RPC network: expected chain ${expected}`);
    if (!(await this.client.getCode({ address: this.market }))) throw new Error('Market contract is not deployed at the configured address');
    const router = await this.client.readContract({ address: this.market, abi: this.abi, functionName: 'router' }) as Address;
    if (getAddress(router) !== this.router) throw new Error('Configured router does not match the contract signer');
    const [native, symbol, decimals] = await Promise.all([
      this.read('IS_NATIVE_ASSET', []), this.read('ASSET_SYMBOL', []), this.read('ASSET_DECIMALS', []),
    ]);
    if (native !== true || symbol !== 'MON' || Number(decimals) !== 18) throw new Error('Configured market is not the native MON market; refusing to reinterpret ERC-20 balances');
    if (this.mode === 'monad-testnet') {
      let stdout: string;
      try { ({ stdout } = await exec('alchemy', ['--json', '--no-interactive', 'wallet', 'status'], { timeout: 15_000 })); }
      catch { throw new Error('Unable to check the Alchemy wallet session. Verify the CLI session before starting the router.'); }
      const status = JSON.parse(stdout);
      const session = status.session;
      if (!(status.valid || session?.valid) || getAddress(status.walletAddress ?? session?.address ?? '0x0000000000000000000000000000000000000000') !== this.router) {
        throw new Error('Connect the authorized Alchemy session wallet before starting the Monad router');
      }
      const capabilities = status.signerCapabilities ?? session?.signerCapabilities;
      if (!Array.isArray(capabilities) || !capabilities.includes('evm.signTransaction')) throw new Error('The Alchemy session does not authorize direct EVM transaction signing');
    }
  }

  async getAccount(wallet: string): Promise<ChainAccount> {
    const address = getAddress(wallet);
    const [balance, id] = await Promise.all([
      this.read('balances', [address]) as Promise<bigint>,
      this.read('activeGrantId', [address]) as Promise<bigint>,
    ]);
    if (id === 0n) return { available: decimal(balance), authorized: decimal(0n), authorizationExpiresAt: 0 };
    const grant = await this.read('getGrant', [address, id]) as Grant;
    const expiresAt = Number(grant.expiresAt);
    const remaining = grant.totalLimit - grant.spent - grant.locked;
    return { available: decimal(balance), authorized: decimal(!grant.revoked && expiresAt > Date.now() / 1000 ? remaining : 0n), authorizationExpiresAt: expiresAt };
  }

  async getQuote(wallet: string, model: string): Promise<Quote | null> {
    const quote = await this.read('getQuote', [getAddress(wallet), opaqueId(model)]) as OnchainQuote;
    if (!quote.active) return null;
    return { ...formatPrices(quote.prices), minReserve: decimal(quote.minReserve), version: quote.version.toString() };
  }

  lock(input: LockInput): Promise<{ txHash: string }> {
    return this.serialize(async () => {
      const previous = await this.rawOrder(input.id);
      if (previous.state !== 0) {
        if (previous.state !== 1 || getAddress(previous.buyer) !== getAddress(input.buyer) || getAddress(previous.provider) !== getAddress(input.seller) || previous.modelId !== opaqueId(input.model) || previous.reserved !== units(input.budget)) throw new Error('Request ID conflicts with an existing chain order');
        return { txHash: await this.orderTransaction(input.id, 'OrderReserved') };
      }
      if (!input.quote.version) throw new Error('A verified chain quote version is required');
      const txHash = await this.send('reserve', [opaqueId(input.id), getAddress(input.buyer), getAddress(input.seller), opaqueId(input.model), units(input.budget), BigInt(input.deadline), BigInt(input.quote.version)]);
      this.hashes.set(`OrderReserved:${input.id}`, txHash);
      return { txHash };
    });
  }

  settle(input: SettleInput): Promise<{ txHash: string }> {
    return this.serialize(async () => {
      const order = await this.rawOrder(input.id);
      const computed = input.outcome >= 3 ? 0n : fee({ ...formatPrices(order.prices), minReserve: '0' }, input.usage);
      if (computed !== units(input.charge)) throw new Error('Router calculation does not match chain settlement pricing');
      if (order.state === 2) {
        if (order.charged !== computed || order.outcome !== input.outcome) throw new Error('A different settlement already exists');
        return { txHash: await this.orderTransaction(input.id, 'OrderSettled') };
      }
      if (order.state !== 1) throw new Error('Order has not been locked or has already been reclaimed');
      const usage = { input: BigInt(input.usage.input), cacheRead: BigInt(input.usage.cacheRead), cacheWrite: BigInt(input.usage.cacheWrite), output: BigInt(input.usage.output) };
      const txHash = await this.send('settle', [opaqueId(input.id), usage, input.outcome]);
      this.hashes.set(`OrderSettled:${input.id}`, txHash);
      return { txHash };
    });
  }

  async getOrder(id: string): Promise<ChainOrder> {
    const order = await this.rawOrder(id);
    if (order.state === 0) return { state: 'unknown' };
    const eventName = order.state === 1 ? 'OrderReserved' : order.state === 2 ? 'OrderSettled' : 'OrderReclaimed';
    const txHash = await this.orderTransaction(id, eventName).catch(() => undefined);
    return { state: order.state === 1 ? 'locked' : order.state === 2 ? 'settled' : 'refunded', charge: decimal(order.charged), txHash };
  }

  private read(functionName: string, args: readonly unknown[]): Promise<unknown> {
    return this.client.readContract({ address: this.market, abi: this.abi, functionName, args });
  }
  private async rawOrder(id: string): Promise<Order> { return this.read('getOrder', [opaqueId(id)]) as Promise<Order>; }
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const task = this.pending.then(fn);
    this.pending = task.catch(() => {});
    return task;
  }
  private async send(functionName: string, args: readonly unknown[]): Promise<Hex> {
    await this.client.simulateContract({ address: this.market, abi: this.abi, functionName, args, account: this.router });
    const hash = await this.sender(functionName, args);
    const receipt = await this.client.waitForTransactionReceipt({ hash, timeout: 60_000, confirmations: 1 });
    if (receipt.status !== 'success') throw new Error(`${functionName} transaction reverted`);
    if (getAddress(receipt.from) !== this.router || !receipt.to || getAddress(receipt.to) !== this.market) throw new Error('Confirmed receipt does not match the configured router and market');
    return hash;
  }
  private async orderTransaction(id: string, eventName: string): Promise<Hex> {
    const cached = this.hashes.get(`${eventName}:${id}`);
    if (cached) return cached;
    const block = await this.client.getBlockNumber();
    // Recovery scans a bounded window; normal operation persists returned hashes in the order store.
    const logs = await this.client.getContractEvents({ address: this.market, abi: this.abi, eventName, args: { requestId: opaqueId(id) }, fromBlock: block > 2000n ? block - 2000n : 0n, toBlock: block });
    const hash = logs.at(-1)?.transactionHash;
    if (!hash) throw new Error('Transaction hash is outside the recovery window; inspect the chain order');
    this.hashes.set(`${eventName}:${id}`, hash);
    return hash;
  }
}

function formatPrices(prices: Prices) {
  return { input: decimal(prices.input), cacheRead: decimal(prices.cacheRead), cacheWrite: decimal(prices.cacheWrite), output: decimal(prices.output) };
}

export async function createEvmChainFromEnv(): Promise<EvmChain> {
  const mode = process.env.CHAIN_MODE;
  if (mode !== 'anvil' && mode !== 'monad-testnet') throw new Error('CHAIN_MODE must explicitly be anvil or monad-testnet');
  if (!process.env.MARKET_ADDRESS || !process.env.ROUTER_ADDRESS) throw new Error('MARKET_ADDRESS and ROUTER_ADDRESS are required after deployment');
  const chain = new EvmChain({ mode, rpcUrl: process.env.RPC_URL ?? (mode === 'anvil' ? 'http://127.0.0.1:8545' : 'https://testnet-rpc.monad.xyz'), marketAddress: getAddress(process.env.MARKET_ADDRESS), routerAddress: getAddress(process.env.ROUTER_ADDRESS) });
  await chain.ready();
  return chain;
}
