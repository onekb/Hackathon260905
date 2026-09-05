import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { verifyMessage } from 'viem';
import { ProviderClient } from '../src/client.js';
import { parseConfig } from '../src/config.js';

async function waitUntil(condition: () => boolean, timeout = 3000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) throw new Error('Timed out waiting for provider event');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function fixture(options: { invalidDomain?: boolean; invalidExpiry?: boolean; rejection?: string } = {}) {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1', path: '/provider' });
  await new Promise<void>((resolve, reject) => { wss.once('listening', resolve); wss.once('error', reject); });
  const address = wss.address();
  if (!address || typeof address === 'string') throw new Error('Missing test WS address');
  const host = `127.0.0.1:${address.port}`;
  const messages: Record<string, any>[] = [];
  const sockets: WebSocket[] = [];
  let authValid = false;
  wss.on('connection', (socket) => {
    sockets.push(socket);
    const nonce = randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + (options.invalidExpiry ? -1000 : 60000)).toISOString();
    const message = `InferPool provider authentication\nDomain: ${options.invalidDomain ? 'untrusted.invalid' : host}\nNonce: ${nonce}\nExpires: ${expiresAt}`;
    socket.on('message', (raw) => {
      const incoming = JSON.parse(raw.toString());
      messages.push(incoming);
      if (incoming.type === 'auth') {
        void verifyMessage({ address: incoming.address, message, signature: incoming.signature }).then((valid) => {
          authValid = valid;
          if (options.rejection) {
            socket.send(JSON.stringify({ type: 'rejected', message: options.rejection }));
            socket.close(4004, 'No on-chain quote');
            return;
          }
          socket.send(JSON.stringify({ type: 'authenticated', asset_symbol: 'MON', asset_decimals: 18, market_address: 'memory:mon', providerId: 'seller-test', quote: { input: '30.000000', cacheRead: '3.000000', cacheWrite: '37.500000', output: '80.000000', minReserve: '0.010000', version: '2' } }));
        });
      }
    });
    socket.send(JSON.stringify({ type: 'challenge', nonce, message, expiresAt }));
  });
  const config = parseConfig(['--router', `ws://${host}/provider`, '--id', 'seller-test', '--interval-ms', '5', '--chunk-size', '3', '--input-price', '30', '--cache-read-price', '3', '--cache-write-price', '37.5', '--output-price', '80', '--min-reserve', '0.01'], {});
  const client = new ProviderClient(config, privateKeyToAccount(generatePrivateKey()));
  client.online();
  const request = (id: string, maxTokens = 21) => ({
    type: 'request', requestId: id, buyer: 'buyer-test', model: 'mock-reasoner',
    messages: [{ role: 'user', content: '测试Unicode👩🏽‍💻' }], maxTokens,
    cache: 'none', usage: { input: 12, cacheRead: 0, cacheWrite: 0, output: 0 },
  });
  return {
    client, messages, sockets, request, authValid: () => authValid,
    close: async () => {
      client.offline();
      for (const socket of wss.clients) socket.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}

test('WS challenge authenticates wallet ownership then streams exact sequenced units', async () => {
  const f = await fixture();
  try {
    await waitUntil(() => f.client.snapshot().status === 'online');
    assert.equal(f.authValid(), true);
    const auth = f.messages.find((message) => message.type === 'auth');
    assert.equal(auth?.mock, true);
    assert.equal(auth?.provider.id, 'seller-test');
    assert.equal(auth?.provider.capacity, 2);
    assert.ok(f.messages.some((message) => message.type === 'heartbeat'));
    f.sockets[0]!.send(JSON.stringify(f.request('stream-1', 21)));
    await waitUntil(() => f.messages.some((message) => message.type === 'completed'));
    const chunks = f.messages.filter((message) => message.type === 'chunk');
    assert.deepEqual(chunks.map((chunk) => chunk.seq), [0, 1, 2, 3, 4, 5, 6]);
    assert.equal(chunks.reduce((sum, chunk) => sum + Array.from(chunk.text).length, 0), 21);
    assert.equal(f.client.engine.activeCount, 0);
  } finally { await f.close(); }
});

test('explicit WS cancel stops timeout and frees capacity, reconnect never replays old IDs', async () => {
  const f = await fixture();
  try {
    await waitUntil(() => f.client.snapshot().status === 'online');
    f.client.setMode('timeout');
    f.sockets[0]!.send(JSON.stringify(f.request('cancel-1')));
    await waitUntil(() => f.client.engine.activeCount === 1);
    f.sockets[0]!.send(JSON.stringify({ type: 'cancel', requestId: 'cancel-1', reason: 'buyer_cancelled' }));
    await waitUntil(() => f.messages.some((message) => message.type === 'cancelled'));
    assert.equal(f.client.engine.activeCount, 0);
    f.sockets[0]!.send(JSON.stringify(f.request('disconnect-1')));
    await waitUntil(() => f.client.engine.activeCount === 1);
    f.sockets[0]!.terminate();
    await waitUntil(() => f.client.engine.activeCount === 0);
    await waitUntil(() => f.sockets.length === 2 && f.client.snapshot().status === 'online');
    f.sockets[1]!.send(JSON.stringify(f.request('disconnect-1')));
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(f.messages.filter((message) => message.type === 'started' && message.requestId === 'disconnect-1').length, 1);
    assert.equal(f.client.engine.activeCount, 0);
    assert.equal(f.client.engine.snapshots().find((run) => run.requestId === 'disconnect-1')?.status, 'disconnected');
  } finally { await f.close(); }
});

test('wrong-domain and expired challenges are rejected without sending a wallet signature', async () => {
  for (const options of [{ invalidDomain: true }, { invalidExpiry: true }]) {
    const f = await fixture(options);
    try {
      await waitUntil(() => f.client.snapshot().status === 'reconnecting');
      assert.equal(f.messages.filter((message) => message.type === 'auth').length, 0);
      assert.equal(f.client.engine.activeCount, 0);
    } finally { await f.close(); }
  }
});

test('saving local configuration never overwrites the quote verified by the platform', async () => {
  const f = await fixture();
  try {
    await waitUntil(() => f.client.snapshot().status === 'online');
    assert.equal(f.client.snapshot().effectivePricing?.output, '80.000000');
    assert.equal(f.client.snapshot().pricingMatchesEffective, true);
    assert.equal(f.client.snapshot().effectivePricing?.version, '2');
    f.client.setPricing({ input: '30', cacheRead: '3', cacheWrite: '37.5', output: '99', minReserve: '0.01' });
    await waitUntil(() => f.sockets.length === 2 && f.client.snapshot().status === 'online');
    const state = f.client.snapshot();
    assert.equal(state.pricing.output, '99');
    assert.equal(state.effectivePricing?.output, '80.000000');
    assert.equal(state.pricingMatchesEffective, false);
    assert.ok(state.effectivePricingVerifiedAt);
    f.client.offline();
    assert.equal(f.client.snapshot().effectivePricing?.output, '80.000000');
  } finally { await f.close(); }
});

test('rejected preserves the platform reason after close so unpublished quotes are actionable', async () => {
  const f = await fixture({ rejection: 'Publish an active model quote on the configured chain before connecting' });
  try {
    await waitUntil(() => f.client.snapshot().status === 'reconnecting');
    const state = f.client.snapshot();
    assert.match(state.lastError ?? '', /Publish an active model quote/);
    assert.match(state.rejectedReason ?? '', /configured chain/);
    assert.equal(state.effectivePricing, null);
    assert.equal(state.active, 0);
    f.client.offline();
    assert.equal(f.client.snapshot().lastError, null);
  } finally { await f.close(); }
});
