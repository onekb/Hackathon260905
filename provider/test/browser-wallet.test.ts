import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { verifyMessage } from 'viem';
import { WebSocketServer, type WebSocket } from 'ws';
import { BrowserWalletBridge, providerChallenge } from '../src/signer.js';
import { parseConfig } from '../src/config.js';
import { startProvider } from '../src/main.js';

const wallet = privateKeyToAccount(generatePrivateKey());
const wrongWallet = privateKeyToAccount(generatePrivateKey());
const router = 'ws://127.0.0.1:8788/provider';
const challenge = (url = router, nonce = randomBytes(24).toString('hex'), expiresAt = Date.now() + 60_000) => ({
  nonce, expiresAt,
  message: `InferPool provider authentication\nDomain: ${new URL(url).host}\nNonce: ${nonce}\nExpires: ${expiresAt}\nThis signature authenticates this session only. It does not authorize token transfers.`,
});
const bridge = (timeoutMs?: number) => new BrowserWalletBridge({ browserWallet: wallet.address, router }, { timeoutMs });
async function waitUntil(condition: () => boolean, timeout = 2500) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) throw new Error('Timed out waiting for handshake');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test('browser signer requires one explicit ready and verifies only the configured wallet, refusing replay', async () => {
  const b = bridge(); const c = challenge();
  await assert.rejects(b.account.signMessage({ message: c.message }), /准备好签名/);
  assert.throws(() => b.prepare(wrongWallet.address), /不匹配/);
  b.prepare(wallet.address);
  const signature = b.account.signMessage({ message: c.message });
  const pending = b.challenge()!;
  assert.equal(pending.message, c.message);
  await assert.rejects(b.submit('wrong-id', await wallet.signMessage({ message: c.message })), /不存在/);
  assert.equal(b.challenge()?.requestId, pending.requestId);
  const signed = await wallet.signMessage({ message: c.message });
  await b.submit(pending.requestId, signed);
  assert.equal(await signature, signed);
  assert.equal(b.challenge(), null);
  await assert.rejects(b.submit(pending.requestId, signed), /不存在/);
  await assert.rejects(b.account.signMessage({ message: challenge().message }), /准备好签名/);
  b.prepare(wallet.address);
  await assert.rejects(b.account.signMessage({ message: c.message }), /重放/);
});

test('exact provider challenge policy rejects arbitrary text, buyer scope, bad domain, malformed expiry and extra lines', () => {
  const c = challenge();
  assert.equal(providerChallenge(c.message, router).nonce, c.nonce);
  for (const text of ['sign any message', c.message.replace('provider authentication', 'buyer authentication'), c.message.replace('127.0.0.1:8788', 'evil.invalid'), c.message + '\n', c.message.replace(c.nonce, 'short'), challenge(router, c.nonce, Date.now() - 1).message, challenge(router, c.nonce, Date.now() + 600_000).message, c.message.replace(String(c.expiresAt), new Date(c.expiresAt).toISOString())]) {
    assert.throws(() => providerChallenge(text, router), /挑战/);
  }
});

test('wrong-wallet signatures, superseding challenges, explicit offline and timeout clear pending signing', async () => {
  const b = bridge(); b.prepare(wallet.address); const c = challenge();
  const rejected = assert.rejects(b.account.signMessage({ message: c.message }), /不匹配/);
  await assert.rejects(b.submit(b.challenge()!.requestId, await wrongWallet.signMessage({ message: c.message })), /不匹配/);
  await rejected; assert.equal(b.challenge(), null);
  b.prepare(wallet.address);
  const superseded = assert.rejects(b.account.signMessage({ message: challenge().message }), /新的挑战/);
  await assert.rejects(b.account.signMessage({ message: challenge().message }), /准备好签名/);
  await superseded;
  b.prepare(wallet.address);
  const offline = assert.rejects(b.account.signMessage({ message: challenge().message }), /offline/);
  b.account.cancelPendingSignature?.('offline'); await offline; assert.equal(b.challenge(), null);
  const short = bridge(15); short.prepare(wallet.address);
  const timeout = assert.rejects(short.account.signMessage({ message: challenge().message }), /超时/);
  await new Promise(resolve => setTimeout(resolve, 30)); await timeout;
  assert.equal(short.challenge(), null);
});

async function fixture(options: { badEnvelope?: boolean } = {}) {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1', path: '/provider' });
  await new Promise<void>((resolve, reject) => { wss.once('listening', resolve); wss.once('error', reject); });
  const wsAddress = wss.address(); if (!wsAddress || typeof wsAddress === 'string') throw new Error('Missing WS address');
  const url = `ws://127.0.0.1:${wsAddress.port}/provider`;
  const sockets: WebSocket[] = []; const auths: unknown[] = [];
  wss.on('connection', socket => {
    sockets.push(socket); const c = challenge(url);
    socket.on('message', raw => {
      const message = JSON.parse(raw.toString());
      if (message.type !== 'auth') return;
      void verifyMessage({ address: wallet.address, message: c.message, signature: message.signature }).then(valid => {
        if (!valid) return socket.close(4001);
        auths.push(message);
        socket.send(JSON.stringify({ type: 'authenticated', providerId: 'seller-browser', quote: { input: '30', cacheRead: '3', cacheWrite: '37.5', output: '80', minReserve: '0.0001', version: '1' } }));
      });
    });
    socket.send(JSON.stringify({ type: 'challenge', ...c, ...(options.badEnvelope ? { nonce: 'f'.repeat(48) } : {}) }));
  });
  const config = { ...parseConfig(['--browser-wallet', wallet.address, '--wallet-ui', 'http://127.0.0.1:3000', '--router', url, '--id', 'seller-browser', '--min-reserve', '0.0001'], {}), port: 0 };
  const b = new BrowserWalletBridge(config);
  const node = await startProvider(config, b.account, b);
  const address = node.server.address(); if (!address || typeof address === 'string') throw new Error('Missing console address');
  const origin = `http://127.0.0.1:${address.port}`;
  const html = await (await fetch(origin)).text();
  const token = html.match(/name="provider-control" content="([a-f0-9]{64})"/)?.[1];
  assert.ok(token);
  const post = (path: string, payload = {}, extra: { token?: string; origin?: string } = {}) => fetch(origin + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Provider-Control': extra.token ?? token, Origin: extra.origin ?? origin }, body: JSON.stringify(payload),
  });
  return { origin, node, b, sockets, auths, post, close: async () => {
    await node.stop(); for (const socket of wss.clients) socket.terminate();
    await new Promise<void>(resolve => wss.close(() => resolve()));
  } };
}

test('HTTP control stays same-origin/CSRF protected; explicit ready completes real WS auth and no implicit reconnect', async () => {
  const f = await fixture();
  try {
    assert.equal(f.node.client.snapshot().status, 'offline'); assert.equal(f.sockets.length, 0);
    assert.equal((await f.post('/api/browser/ready', { wallet: wallet.address }, { token: 'bad' })).status, 403);
    assert.equal((await f.post('/api/browser/ready', { wallet: wallet.address }, { origin: 'http://127.0.0.1:3000' })).status, 403);
    assert.equal((await f.post('/api/browser/challenge', {}, { token: 'bad' })).status, 403);
    assert.equal((await fetch(f.origin + '/api/browser/challenge')).status, 404);
    assert.equal((await f.post('/api/online')).status, 400);
    assert.equal((await f.post('/api/browser/ready', { wallet: wrongWallet.address })).status, 400);
    assert.equal(f.sockets.length, 0);
    assert.equal((await f.post('/api/browser/ready', { wallet: wallet.address })).status, 200);
    await waitUntil(() => f.b.challenge() !== null);
    const pending = (await (await f.post('/api/browser/challenge')).json()).challenge;
    const publicState = await (await fetch(f.origin + '/api/state')).json();
    assert.equal(publicState.walletMode, 'browser-wallet'); assert.equal(publicState.browserWallet.status, 'signing');
    assert.ok(!JSON.stringify(publicState).includes(pending.message));
    const signature = await wallet.signMessage({ message: pending.message });
    assert.equal((await f.post('/api/browser/signature', { requestId: pending.requestId, signature })).status, 200);
    await waitUntil(() => f.node.client.snapshot().status === 'online');
    assert.equal(f.auths.length, 1); assert.equal(f.node.client.snapshot().availableSlots, 2);
    assert.equal(f.node.client.snapshot().effectivePricing?.version, '1');
    assert.equal((await f.post('/api/browser/signature', { requestId: pending.requestId, signature })).status, 400);
    f.sockets[0]!.terminate();
    await waitUntil(() => f.node.client.snapshot().status === 'offline');
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.equal(f.sockets.length, 1); assert.equal(f.node.client.snapshot().enabled, false);
    assert.equal(f.b.challenge(), null);
  } finally { await f.close(); }
});

test('offline invalidates a pending HTTP signature and forged WS envelope never reaches wallet queue', async () => {
  const f = await fixture();
  try {
    await f.post('/api/browser/ready', { wallet: wallet.address }); await waitUntil(() => f.b.challenge() !== null);
    const pending = f.b.challenge()!;
    await f.post('/api/offline');
    assert.equal(f.b.challenge(), null);
    const signature = await wallet.signMessage({ message: pending.message });
    assert.equal((await f.post('/api/browser/signature', { requestId: pending.requestId, signature })).status, 400);
    assert.equal(f.auths.length, 0); assert.equal(f.node.client.snapshot().status, 'offline');
  } finally { await f.close(); }
  const forged = await fixture({ badEnvelope: true });
  try {
    await forged.post('/api/browser/ready', { wallet: wallet.address });
    await waitUntil(() => forged.sockets.length === 1 && forged.node.client.snapshot().status === 'offline');
    assert.equal(forged.b.challenge(), null); assert.equal(forged.auths.length, 0);
  } finally { await forged.close(); }
});
