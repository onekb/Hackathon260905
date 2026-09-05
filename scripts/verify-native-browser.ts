/** Read-only, fixed-scope RPC evidence for the approved independent-wallet browser MON demo. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { createPublicClient, decodeFunctionData, encodeFunctionData, getAddress, http, keccak256, stringToHex, type Abi, type Address, type Hex } from 'viem';
import { monadTestnet } from 'viem/chains';
import { decimal, fee, units, type Usage } from '../server/src/money.js';

const root = new URL('../', import.meta.url);
const file = new URL('contracts/deployments/inferpool-native-browser.json', root);
const json = (url: URL) => JSON.parse(readFileSync(url, 'utf8'));
const market = getAddress('0x142a4904307244Bed0cECD72dE8329A253333182');
const buyer = getAddress('0xbc81A46F5eeE3924aA0B7fD8849eA08351194A75');
const seller = getAddress('0xAc801eEC099C65A605B809b98A09A62674614A08');
assert.notEqual(buyer, seller);
const deployment = json(new URL('contracts/deployments/inferpool-mon-native-testnet.json', root));
assert.equal(deployment.chainId, 10143); assert.equal(getAddress(deployment.market), market); assert.equal(getAddress(deployment.router), seller);
const abi = json(new URL('contracts/out/InferenceMarket.sol/InferenceMarket.json', root)).abi as Abi;
// Public RPC only. No wallet client, delegated session, environment credentials or transaction sender.
let nextRpcAt = 0;
const client = createPublicClient({ chain: monadTestnet, transport: http('https://testnet-rpc.monad.xyz', {
  // Leave headroom under the public endpoint's 15 calls/second limit for the active browser.
  onFetchRequest: async () => { const wait = Math.max(0, nextRpcAt - Date.now()); nextRpcAt = Math.max(nextRpcAt, Date.now()) + 250; if (wait) await delay(wait); },
}), pollingInterval: 500 });
const read = (functionName: string, args: readonly unknown[], blockNumber: bigint) => client.readContract({ address: market, abi, functionName, args, blockNumber });
const modelId = keccak256(stringToHex('mock-reasoner'));
const encode = (value: unknown) => JSON.stringify(value, (_k, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n';
const report: any = existsSync(file) ? json(file) : {
  chainId: 10143, network: 'monad-testnet', market, buyer, seller, router: seller,
  asset: { native: true, symbol: 'MON', decimals: 18 },
  scope: 'Independent-wallet browser validation: Para buyer B deposits 0.1 test MON, authorizes at most 0.05 MON for 24 hours, and submits normal plus seller-failure requests with a 0.001 MON budget each. Seller A also operates the Router. Inference is explicitly mocked; RPC verifies chain state and transactions, not browser interaction.',
  approved: { depositMON: '0.1', grantLimitMON: '0.05', grantDurationSeconds: 86400, requestBudgetMON: '0.001', cases: ['normal', 'seller_failed'] },
  actions: {}, cases: {},
};
assert.equal(report.chainId, 10143); assert.equal(getAddress(report.market), market); assert.equal(getAddress(report.buyer), buyer); assert.equal(getAddress(report.seller), seller);
const save = () => { report.updatedAt = new Date().toISOString(); const temporary = new URL(file.href + '.tmp'); writeFileSync(temporary, encode(report)); renameSync(temporary, file); };
const option = (name: string) => { const at = process.argv.indexOf(name); return at < 0 ? undefined : process.argv[at + 1]; };
const hashArgument = (name: string): Hex => { const value = option(name); assert.ok(value && /^0x[0-9a-fA-F]{64}$/.test(value), `${name} must be a transaction hash`); return value as Hex; };
const bigint = (value: unknown) => BigInt(value as string | number | bigint);
const assertSame = (actual: unknown, expected: unknown) => assert.equal(encode(actual), encode(expected));

async function snapshot(blockNumber?: bigint) {
  const block = await client.getBlock(blockNumber === undefined ? {} : { blockNumber });
  const at = block.number;
  const [buyerWallet, sellerWallet, buyerEscrow, sellerEscrow, grantId, totalEscrowed, totalLocked, marketBalance, quote] = await Promise.all([
    client.getBalance({ address: buyer, blockNumber: at }), client.getBalance({ address: seller, blockNumber: at }),
    read('balances', [buyer], at), read('balances', [seller], at), read('activeGrantId', [buyer], at),
    read('totalEscrowed', [], at), read('totalLocked', [], at), client.getBalance({ address: market, blockNumber: at }),
    read('getQuote', [seller, modelId], at),
  ]);
  const grant = BigInt(grantId as bigint) === 0n ? null : await read('getGrant', [buyer, grantId], at) as any;
  const authorization = grant && !grant.revoked && bigint(grant.expiresAt) > block.timestamp ? bigint(grant.totalLimit) - bigint(grant.spent) - bigint(grant.locked) : 0n;
  return {
    blockNumber: at, blockHash: block.hash, blockTimestamp: block.timestamp,
    buyer: { address: buyer, walletWei: buyerWallet, walletMON: decimal(buyerWallet), escrowWei: buyerEscrow, escrowMON: decimal(buyerEscrow as bigint), grantId, grant, availableAuthorizationWei: authorization, availableAuthorizationMON: decimal(authorization) },
    seller: { address: seller, walletWei: sellerWallet, walletMON: decimal(sellerWallet), escrowWei: sellerEscrow, escrowMON: decimal(sellerEscrow as bigint) },
    marketBalanceWei: marketBalance, totalEscrowedWei: totalEscrowed, totalLockedWei: totalLocked, sellerQuote: quote,
  };
}

async function transactionEvidence(hash: Hex, from: Address, functionName: string, expectedArgs?: readonly unknown[], expectedValue = 0n) {
  const [receipt, transaction] = await Promise.all([client.getTransactionReceipt({ hash }), client.getTransaction({ hash })]);
  assert.equal(receipt.status, 'success'); assert.equal(getAddress(receipt.from), from); assert.equal(getAddress(receipt.to!), market);
  assert.equal(getAddress(transaction.from), from); assert.equal(getAddress(transaction.to!), market);
  assert.equal(transaction.value, expectedValue);
  const decoded = decodeFunctionData({ abi, data: transaction.input });
  assert.equal(decoded.functionName, functionName);
  if (expectedArgs) assert.equal(transaction.input, encodeFunctionData({ abi, functionName, args: expectedArgs }));
  const gasCost = transaction.gas * receipt.effectiveGasPrice;
  return { hash, functionName, args: decoded.args ?? [], input: transaction.input, selector: transaction.input.slice(0, 10), status: receipt.status, blockNumber: receipt.blockNumber, from, to: market, valueWei: expectedValue, valueMON: decimal(expectedValue), gasLimit: transaction.gas, gasUsed: receipt.gasUsed, effectiveGasPrice: receipt.effectiveGasPrice, gasCostWei: gasCost, gasCostMON: decimal(gasCost), gasAccounting: 'Monad gas limit multiplied by receipt effectiveGasPrice', explorerUrl: `https://testnet.monadscan.com/tx/${hash}` };
}

async function verifyAction(name: 'deposit' | 'grant', hash: Hex) {
  assert.ok(report.before, 'Capture the initial snapshot before verifying browser actions');
  const existing = report.actions[name]; if (existing) assert.equal(existing.transaction.hash.toLowerCase(), hash.toLowerCase(), 'Do not overwrite a different browser action');
  const transaction = await transactionEvidence(hash, buyer, name === 'deposit' ? 'deposit' : 'authorizeRouter', name === 'deposit' ? [] : undefined, name === 'deposit' ? units('0.1') : 0n);
  const [before, after] = await Promise.all([snapshot(transaction.blockNumber - 1n), snapshot(transaction.blockNumber)]);
  assert.equal(bigint(after.seller.escrowWei), bigint(before.seller.escrowWei));
  assert.equal(bigint(before.buyer.walletWei) - bigint(after.buyer.walletWei), transaction.valueWei + transaction.gasCostWei, 'Buyer native wallet change must equal exact deposit value plus its Monad gas');
  assert.equal(bigint(after.totalLockedWei), bigint(before.totalLockedWei));
  if (name === 'deposit') {
    assert.equal(bigint(after.buyer.escrowWei) - bigint(before.buyer.escrowWei), units('0.1'));
    assert.equal(bigint(after.totalEscrowedWei) - bigint(before.totalEscrowedWei), units('0.1'));
    assert.equal(bigint(after.marketBalanceWei) - bigint(before.marketBalanceWei), units('0.1'));
    assert.equal(bigint(after.buyer.grantId), bigint(before.buyer.grantId));
  } else {
    const args = transaction.args as readonly unknown[];
    assert.equal(args.length, 2); assert.equal(bigint(args[0]), units('0.05'));
    const expiresAt = bigint(args[1]);
    assert.ok(expiresAt > after.blockTimestamp && expiresAt <= after.blockTimestamp + 86400n, 'Spending grant must expire within 24 hours of confirmation');
    assert.equal(bigint(after.buyer.grantId), bigint(before.buyer.grantId) + 1n);
    assert.equal(bigint(after.buyer.grant.totalLimit), units('0.05'));
    assert.equal(bigint(after.buyer.grant.expiresAt), expiresAt);
    assert.equal(after.buyer.grant.revoked, false);
    assert.equal(bigint(after.buyer.grant.spent), 0n); assert.equal(bigint(after.buyer.grant.locked), 0n);
    assert.equal(bigint(after.buyer.escrowWei), bigint(before.buyer.escrowWei));
    assert.equal(bigint(after.totalEscrowedWei), bigint(before.totalEscrowedWei));
    assert.equal(bigint(after.marketBalanceWei), bigint(before.marketBalanceWei));
  }
  report.actions[name] = { verifiedAt: new Date().toISOString(), transaction, before, after }; save();
  console.log(encode({ verified: name, transactionHash: hash, buyerWalletMON: after.buyer.walletMON, buyerEscrowMON: after.buyer.escrowMON, availableAuthorizationMON: after.buyer.availableAuthorizationMON }));
}

async function verifyCase(name: 'normal' | 'seller_failed') {
  assert.ok(report.actions.deposit && report.actions.grant, 'Verify the approved deposit and grant first');
  const id = option('--id'); assert.ok(id && /^[0-9a-f-]{36}$/i.test(id), '--id must be the known browser request UUID');
  const reserveHash = hashArgument('--reserve'); const settleHash = hashArgument('--settle');
  const existing = report.cases[name];
  if (existing) { assert.equal(existing.id, id); assert.equal(existing.reserve.hash.toLowerCase(), reserveHash.toLowerCase()); assert.equal(existing.settle.hash.toLowerCase(), settleHash.toLowerCase()); }
  const counts = option('--usage')?.split(',').map(Number);
  assert.ok(counts && counts.length === 4 && counts.every(value => Number.isSafeInteger(value) && value >= 0), '--usage must contain four integer counts: input,cacheRead,cacheWrite,output');
  const usage: Usage = { input: counts[0]!, cacheRead: counts[1]!, cacheWrite: counts[2]!, output: counts[3]! };
  const chainUsage = Object.fromEntries(Object.entries(usage).map(([key, value]) => [key, BigInt(value)]));
  const outcome = name === 'normal' ? 0 : 3;
  const requestId = keccak256(stringToHex(id));
  const settle = await transactionEvidence(settleHash, seller, 'settle', [requestId, chainUsage, outcome]);
  const order = await read('getOrder', [requestId], settle.blockNumber) as any;
  assert.equal(Number(order.state), 2); assert.equal(Number(order.outcome), outcome);
  assert.equal(getAddress(order.buyer), buyer); assert.equal(getAddress(order.provider), seller); assert.equal(order.modelId, modelId);
  assert.equal(bigint(order.reserved), units('0.001')); assertSame(order.usage, chainUsage);
  const reserve = await transactionEvidence(reserveHash, seller, 'reserve', [requestId, buyer, seller, modelId, units('0.001'), order.deadline, order.quoteVersion]);
  assert.ok(reserve.blockNumber < settle.blockNumber, 'These browser cases must have a separately observable reservation block');
  const [beforeReserve, afterReserve, afterSettle] = await Promise.all([snapshot(reserve.blockNumber - 1n), snapshot(reserve.blockNumber), snapshot(settle.blockNumber)]);
  const reservedOrder = await read('getOrder', [requestId], reserve.blockNumber) as any;
  assert.equal(Number(reservedOrder.state), 1); assert.equal(bigint(reservedOrder.charged), 0n);
  const quote = afterReserve.sellerQuote as any;
  assert.equal(quote.active, true); assert.equal(bigint(order.quoteVersion), bigint(quote.version)); assertSame(order.prices, quote.prices);
  const rates = { input: '0.3', cacheRead: '0.03', cacheWrite: '0.375', output: '0.8', minReserve: '0.000001' };
  for (const key of ['input', 'cacheRead', 'cacheWrite', 'output'] as const) assert.equal(bigint(order.prices[key]), units(rates[key]));
  assert.equal(bigint(quote.minReserve), units(rates.minReserve));
  const calculated = fee(rates, usage); const charged = outcome === 3 ? 0n : calculated;
  assert.equal(bigint(order.charged), charged);
  if (name === 'normal') assert.ok(charged > 0n); else assert.ok(usage.output > 0, 'Seller-failure browser proof should include partial output before failure');
  if (option('--fee') !== undefined) assert.equal(charged, units(option('--fee')!));
  const budget = units('0.001');
  assert.equal(bigint(beforeReserve.buyer.escrowWei) - bigint(afterReserve.buyer.escrowWei), budget);
  assert.equal(bigint(afterReserve.seller.escrowWei), bigint(beforeReserve.seller.escrowWei));
  assert.equal(bigint(afterReserve.buyer.grant.locked) - bigint(beforeReserve.buyer.grant.locked), budget);
  assert.equal(bigint(afterReserve.totalLockedWei) - bigint(beforeReserve.totalLockedWei), budget);
  assert.equal(bigint(afterSettle.buyer.escrowWei) - bigint(afterReserve.buyer.escrowWei), budget - charged);
  assert.equal(bigint(beforeReserve.buyer.escrowWei) - bigint(afterSettle.buyer.escrowWei), charged);
  assert.equal(bigint(afterSettle.seller.escrowWei) - bigint(beforeReserve.seller.escrowWei), charged);
  assert.equal(bigint(afterSettle.buyer.grant.spent) - bigint(beforeReserve.buyer.grant.spent), charged);
  assert.equal(bigint(afterSettle.buyer.grant.locked), 0n); assert.equal(bigint(afterSettle.totalLockedWei), 0n);
  assert.equal(bigint(afterSettle.totalEscrowedWei), bigint(beforeReserve.totalEscrowedWei));
  assert.equal(bigint(afterSettle.marketBalanceWei), bigint(beforeReserve.marketBalanceWei));
  assert.equal(bigint(afterSettle.buyer.walletWei), bigint(beforeReserve.buyer.walletWei), 'Router-paid reserve/settle must not take MON from buyer wallet');
  report.cases[name] = { id, requestId, verifiedAt: new Date().toISOString(), outcome, order, expectedBrowserUsage: usage, inputAndOutputAreMockUnits: true, calculatedBeforeFaultWei: calculated, chargedWei: charged, chargedMON: decimal(charged), releasedWei: budget - charged, releasedMON: decimal(budget - charged), quoteAndUsageVerified: true, independentBuyerSellerAccountingVerified: true, reserve, settle, snapshots: { beforeReserve, afterReserve, afterSettle } };
  save(); console.log(encode({ verified: name, id, outcome, usage, chargedMON: decimal(charged), releasedMON: decimal(budget - charged), buyerEscrowMON: afterSettle.buyer.escrowMON, sellerEscrowMON: afterSettle.seller.escrowMON }));
}

function aggregate() {
  const entries = Object.values(report.cases) as any[];
  if (entries.length !== 2) return;
  assert.ok(report.cases.normal && report.cases.seller_failed);
  const first = entries.reduce((a, b) => bigint(a.reserve.blockNumber) < bigint(b.reserve.blockNumber) ? a : b).snapshots.beforeReserve;
  const last = entries.reduce((a, b) => bigint(a.settle.blockNumber) > bigint(b.settle.blockNumber) ? a : b).snapshots.afterSettle;
  const charged = entries.reduce((sum, entry) => sum + bigint(entry.chargedWei), 0n);
  assert.equal(bigint(first.buyer.escrowWei), units('0.1'));
  assert.equal(bigint(last.buyer.escrowWei), units('0.1') - charged);
  assert.equal(bigint(last.seller.escrowWei) - bigint(report.before.seller.escrowWei), charged);
  assert.equal(bigint(last.buyer.grant.totalLimit), units('0.05')); assert.equal(bigint(last.buyer.grant.spent), charged);
  assert.equal(bigint(last.buyer.grant.locked), 0n); assert.equal(bigint(last.totalLockedWei), 0n);
  assert.equal(bigint(last.totalEscrowedWei) - bigint(report.before.totalEscrowedWei), units('0.1'));
  report.aggregate = { count: 2, finalBlockNumber: last.blockNumber, totalChargedWei: charged, totalChargedMON: decimal(charged), buyerEscrowBeforeMON: first.buyer.escrowMON, buyerEscrowAfterMON: last.buyer.escrowMON, sellerEscrowBeforeMON: report.before.seller.escrowMON, sellerEscrowAfterMON: last.seller.escrowMON, authorizationLimitMON: '0.05', authorizationSpentMON: decimal(charged), authorizationRemainingMON: decimal(units('0.05') - charged), finalBuyerGrantLockedWei: last.buyer.grant.locked, finalMarketLockedWei: last.totalLockedWei, sellerFailureChargedMON: report.cases.seller_failed.chargedMON, independentBuyerAndSellerWallets: true };
  report.verification = { status: 'verified', verifiedAt: report.verification?.verifiedAt ?? new Date().toISOString(), asOfBlockNumber: last.blockNumber, method: 'Read-only independent RPC verification of receipt identities, native value, calldata, on-chain prices/usage/outcomes, and fixed-block buyer/seller/grant accounting', limitations: ['Inference and usage are explicitly mocked and trusted to the Router.', 'Browser completion and bill observations were supplied by the UI operator; this RPC evidence does not prove frame-by-frame browser streaming.', 'Buyer B and seller A are different wallets; seller A and the Router share one wallet.'] };
}

async function main() {
assert.equal(await client.getChainId(), 10143);
const current = await snapshot();
const [native, symbol, decimals, router] = await Promise.all(['IS_NATIVE_ASSET', 'ASSET_SYMBOL', 'ASSET_DECIMALS', 'router'].map(name => read(name, [], current.blockNumber)));
assert.equal(native, true); assert.equal(symbol, 'MON'); assert.equal(Number(decimals), 18); assert.equal(getAddress(router as string), seller);
if (process.argv.includes('--capture-before')) {
  assert.equal(report.before, undefined, 'The original before snapshot is immutable; use --refresh to capture current state');
  assert.equal(current.buyer.escrowWei, 0n, 'Initial native buyer escrow should be empty before the approved deposit');
  assert.equal(current.buyer.grantId, 0n, 'Initial native buyer should have no spending grant');
  report.before = current;
}
report.current = current; save();
if (option('--deposit')) await verifyAction('deposit', hashArgument('--deposit'));
if (option('--grant')) await verifyAction('grant', hashArgument('--grant'));
const caseName = option('--case');
if (caseName !== undefined) { assert.ok(caseName === 'normal' || caseName === 'seller_failed', 'Only the two approved browser cases are accepted'); await verifyCase(caseName); }
aggregate(); save();
console.log(encode({ readOnly: true, beforeSaved: !!report.before, blockNumber: current.blockNumber, buyerWalletMON: current.buyer.walletMON, buyerEscrowMON: current.buyer.escrowMON, buyerGrantId: current.buyer.grantId, sellerEscrowMON: current.seller.escrowMON, totalLockedWei: current.totalLockedWei }));
}
main().catch((error: any) => { console.error(error.shortMessage ?? error.message); process.exitCode = 1; });
