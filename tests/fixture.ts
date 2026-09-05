import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, keccak256, stringToHex, toHex, type Abi, type Address, type Hex } from 'viem';
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { units } from '../server/src/money.js';

// Public Anvil fixture mnemonic. These accounts are ONLY for localhost chain 31337.
const ANVIL_FIXTURE = 'test test test test test test test test test test test junk';
export function localPrivateKey(index: number) {
  const hd = mnemonicToAccount(ANVIL_FIXTURE, { addressIndex: index });
  return toHex(hd.getHdKey().privateKey!);
}
export function localSigner(index: number) { return privateKeyToAccount(localPrivateKey(index)); }
export const rpcUrl = process.env.TEST_RPC_URL ?? 'http://127.0.0.1:18545';
export function artifact(name: string): { abi: Abi; bytecode: { object: Hex } } {
  return JSON.parse(readFileSync(new URL(`../contracts/out/${name}.sol/${name}.json`, import.meta.url), 'utf8'));
}
export async function deployFixture() {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(rpcUrl).hostname)) throw new Error('Test fixture requires a loopback RPC');
  const client = createPublicClient({ chain: foundry, transport: http(rpcUrl), pollingInterval: 100 });
  if (await client.getChainId() !== 31337) throw new Error('Test fixture refuses to use a non-local chain');
  const accounts = Array.from({ length: 5 }, (_, i) => localSigner(i));
  const wallets = accounts.map(account => createWalletClient({ account, chain: foundry, transport: http(rpcUrl) }));
  const [router, buyer, sellerA, sellerB, outsider] = accounts.map(a => a.address) as [Address, Address, Address, Address, Address];
  const receipt = async (hash: Hex) => {
    const value = await client.waitForTransactionReceipt({ hash });
    if (value.status !== 'success') throw new Error('Fixture transaction reverted');
    return value;
  };
  const marketArtifact = artifact('InferenceMarket');
  const market = (await receipt(await wallets[0]!.deployContract({ abi: marketArtifact.abi, bytecode: marketArtifact.bytecode.object, args: [router] }))).contractAddress!;
  const write = async (index: number, functionName: string, args: readonly unknown[] = [], value = 0n) => {
    return receipt(await wallets[index]!.writeContract({ address: market, abi: marketArtifact.abi, functionName, args, value }));
  };
  // Anvil funds public fixture accounts with native currency; deposit carries MON as msg.value.
  await write(1, 'deposit', [], units('100'));
  const block = await client.getBlock();
  await write(1, 'authorizeRouter', [units('100'), block.timestamp + 86400n]);
  const prices = { input: units('30'), cacheRead: units('3'), cacheWrite: units('37.5'), output: units('80') };
  const model = 'mock-reasoner';
  const modelId = keccak256(stringToHex(model));
  await write(2, 'upsertQuote', [modelId, prices, units('0.0001'), true]);
  await write(3, 'upsertQuote', [modelId, { ...prices, output: units('100') }, units('0.0001'), true]);
  return { client, accounts, wallets, router, buyer, sellerA, sellerB, outsider, market, abi: marketArtifact.abi, model, modelId, prices, write, receipt };
}
