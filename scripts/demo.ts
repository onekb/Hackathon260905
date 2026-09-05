import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicClient, http } from 'viem';
import { foundry } from 'viem/chains';
import { deployFixture, localPrivateKey, rpcUrl } from '../tests/fixture.js';

if (!['127.0.0.1', 'localhost'].includes(new URL(rpcUrl).hostname)) throw new Error('The demo only runs on a loopback Anvil chain');
if (!existsSync('contracts/out/InferenceMarket.sol/InferenceMarket.json')) throw new Error('Run npm run setup:contracts and forge build --root contracts first');
const children: ChildProcess[] = [];
let shuttingDown = false;
function stop() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of [...children].reverse()) child.kill('SIGTERM');
}
process.on('SIGINT', stop); process.on('SIGTERM', stop); process.on('exit', stop);
function launch(command: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const child = spawn(command, args, { cwd: process.cwd(), env: { ...process.env, ...env }, stdio: ['ignore', 'inherit', 'inherit'] });
  children.push(child);
  child.on('error', error => { console.error(error.message); stop(); });
  child.on('exit', code => { if (code && !shuttingDown) { console.error(`${command} exited with code ${code}`); stop(); process.exitCode = 1; } });
  return child;
}
async function waitFor<T>(fn: () => Promise<T>, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (!shuttingDown && Date.now() < deadline) {
    try { return await fn(); } catch { await new Promise(resolve => setTimeout(resolve, 200)); }
  }
  throw new Error('Demo service did not become ready; check the messages above');
}
try {
  const rpc = createPublicClient({ chain: foundry, transport: http(rpcUrl, { retryCount: 0, timeout: 1000 }) });
  const running = await rpc.getChainId().catch(() => null);
  if (running === null) launch('anvil', ['--silent', '--host', '127.0.0.1', '--port', new URL(rpcUrl).port || '18545']);
  else if (running !== 31337) throw new Error('An existing non-Anvil chain is using the demo RPC endpoint');
  await waitFor(() => rpc.getChainId().then(chain => { if (chain !== 31337) throw new Error('Wrong demo chain'); return chain; }));
  const fixture = await deployFixture();
  mkdirSync('.local', { recursive: true, mode: 0o700 });
  const statePath = resolve('.local', `router-${fixture.market}.json`);
  const config = { chainMode: 'anvil', chainId: 31337, rpcUrl, token: fixture.token, market: fixture.market, router: fixture.router, buyer: fixture.buyer, sellerA: fixture.sellerA, sellerB: fixture.sellerB, model: fixture.model, statePath };
  writeFileSync('.local/deployment.json', JSON.stringify(config, null, 2), { mode: 0o600 });
  launch(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], { CHAIN_MODE: 'anvil', RPC_URL: rpcUrl, MARKET_ADDRESS: fixture.market, TOKEN_ADDRESS: fixture.token, ROUTER_ADDRESS: fixture.router, ROUTER_PUBLIC_URL: 'http://127.0.0.1:8787', ROUTER_STATE_PATH: statePath });
  await waitFor(async () => { const response = await fetch('http://127.0.0.1:8787/health'); if (!response.ok) throw new Error('Router unavailable'); return response; });
  for (const [i, index] of [2, 3].entries()) {
    launch(process.execPath, ['--import', 'tsx', 'provider/src/main.ts', '--router', 'ws://127.0.0.1:8787/provider', '--id', `seller-${i + 1}`, '--name', `演示卖家 ${i + 1}`, '--port', String(8791 + i), '--min-reserve', '0.0001', '--output-price', i ? '100' : '80'], { PROVIDER_PRIVATE_KEY: localPrivateKey(index) });
  }
  await waitFor(async () => { const body = await (await fetch('http://127.0.0.1:8787/health')).json() as any; if (body.providers !== 2) throw new Error('Sellers are connecting'); return body; });
  const post = async (path: string, body: unknown, token?: string) => {
    const response = await fetch('http://127.0.0.1:8787' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`Demo initialization failed at ${path}`);
    return response.json() as Promise<any>;
  };
  const challenge = await post('/auth/challenge', { wallet: fixture.buyer });
  const session = await post('/auth/verify', { wallet: fixture.buyer, nonce: challenge.nonce, signature: await fixture.accounts[1]!.signMessage({ message: challenge.message }) });
  const key = await post('/api-keys', { name: 'Local demo', expires_in_days: 1 }, session.token);
  writeFileSync('.local/demo-credentials.json', JSON.stringify({ apiKey: key.token, sessionToken: session.token, wallet: fixture.buyer }, null, 2), { mode: 0o600 });
  console.log('\nLocal demo ready (Anvil, NOT Monad testnet).\nAPI: http://127.0.0.1:8787\nSeller 1: http://127.0.0.1:8791\nSeller 2: http://127.0.0.1:8792\nRun npm run demo:request in another terminal.\nCredentials remain in ignored .local/demo-credentials.json; Ctrl+C stops the services.');
  await new Promise<void>(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
} catch (error) { console.error(error instanceof Error ? error.message : 'Demo failed'); process.exitCode = 1; }
finally { stop(); }
