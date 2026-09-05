import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { privateKeyToAccount } from 'viem/accounts';
import { createApp } from '../src/app.js';
import { Auth } from '../src/auth.js';
import { MemoryChain } from '../src/chain.js';
import { Engine } from '../src/engine.js';
import { Store } from '../src/store.js';
import { attachProviderHub } from '../src/provider-hub.js';

// Public, unfunded fixture key: these tests only use the isolated MemoryChain.
const seller = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const buyer = '0x2222222222222222222222222222222222222222';
const quote = { input: '0', cacheRead: '0', cacheWrite: '0', output: '1', minReserve: '0.001' };
const request = { model: 'mock-reasoner', messages: [{ role: 'user', content: 'Local stream test' }], max_tokens: 100, max_spend: '0.1' };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function within<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), 2000); })]);
  } finally { clearTimeout(timer); }
}

async function eventually(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await delay(5);
  }
}

async function fixture() {
  const chain = new MemoryChain(); chain.fund(buyer); chain.quote(seller.address, request.model, quote);
  const engine = new Engine(chain, new Store());
  const auth = new Auth(engine.store, 'router.test');
  const server = createServer(createApp(engine, auth, { allowedOrigins: [] }));
  const wss = attachProviderHub(server, engine, 'router.test');
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const socket = new WebSocket(origin.replace('http:', 'ws:') + '/provider');
  const messages: any[] = []; socket.on('message', raw => messages.push(JSON.parse(raw.toString())));
  const [raw] = await once(socket, 'message'); const challenge = JSON.parse(raw.toString());
  const send = (message: unknown) => socket.send(JSON.stringify(message));
  const authenticationMessage = async (message = challenge.message) => ({ type: 'auth', address: seller.address,
    signature: await seller.signMessage({ message }), mock: true,
    provider: { id: 'stream-seller', modelId: request.model, capacity: 2, pricing: quote } });
  const authenticate = async () => {
    const reply = once(socket, 'message');
    send(await authenticationMessage());
    const [raw] = await within(reply, 'Provider authentication timed out');
    assert.equal(JSON.parse(raw.toString()).type, 'authenticated');
  };
  return { chain, engine, auth, origin, socket, send, messages, authenticate, authenticationMessage,
    close: async () => {
      socket.terminate(); for (const client of wss.clients) client.terminate();
      await new Promise<void>(resolve => wss.close(() => resolve()));
      engine.close(); server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

test('one order awaiting settlement does not block another order SSE or provider heartbeats', async () => {
  const s = await fixture(); const settling = deferred(); const release = deferred();
  const settle = s.chain.settle.bind(s.chain); const settledIds: string[] = [];
  let slowId: string | undefined;
  s.chain.settle = async input => {
    if (input.id === slowId) { settling.resolve(); await release.promise; }
    settledIds.push(input.id); return settle(input);
  };
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    await s.authenticate();
    const a = await s.engine.create(buyer, request); slowId = a.id;
    const { token } = s.auth.issue(buyer, 'session', 'Local stream fixture', Date.now() + 60_000);
    const response = await fetch(s.origin + '/v1/chat/completions', { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-InferPool-Market': s.engine.marketIdentity.market_address },
      body: JSON.stringify({ ...request, stream: true }) });
    assert.equal(response.status, 200);
    const b = response.headers.get('x-request-id')!; reader = response.body!.getReader(); const decoder = new TextDecoder();
    assert.match(decoder.decode((await reader.read()).value), /event: request/);
    s.send({ type: 'completed', requestId: a.id, seq: 0 }); await within(settling.promise, 'First order did not enter settlement');
    s.send({ type: 'chunk', requestId: b, seq: 0, text: 'incremental' });
    s.send({ type: 'heartbeat', availableSlots: 1, mode: 'normal' });
    const first = await within(reader.read(), 'Second order SSE was blocked by the first order settlement');
    assert.match(decoder.decode(first.value), /incremental/);
    assert.equal(s.engine.get(b).status, 'running'); assert.equal(s.engine.get(a.id).settlement, 'pending');
    await eventually(() => s.messages.some(message => message.type === 'heartbeat_ack'), 'Heartbeat was blocked by another order settlement');

    // Back-to-back events must retain per-request order, deduplicate and ignore late output.
    s.send({ type: 'chunk', requestId: b, seq: 0, text: 'duplicate' });
    s.send({ type: 'chunk', requestId: b, seq: 1, text: ' output' });
    s.send({ type: 'completed', requestId: b, seq: 2 });
    s.send({ type: 'chunk', requestId: b, seq: 2, text: 'late' });
    const rest = await within((async () => { let body = ''; for (;;) { const part = await reader!.read(); if (part.done) return body; body += decoder.decode(part.value); } })(), 'Second stream did not finish independently');
    assert.match(rest, /\[DONE\]/);
    assert.equal(s.engine.get(b).output, 'incremental output'); assert.equal(s.engine.get(b).usage.output, 18);
    assert.equal(s.engine.get(b).settlement, 'confirmed'); assert.deepEqual(settledIds, [b]);
    assert.equal(s.engine.get(a.id).settlement, 'pending');
    release.resolve(); await within(s.engine.waitForTerminal(a.id), 'First order did not finish after settlement was released');
    assert.deepEqual(settledIds, [b, a.id]);
  } finally { release.resolve(); await reader?.cancel(); await s.close(); }
});

test('queued messages wait for successful authentication and cannot bypass its quote lookup', async () => {
  const s = await fixture(); const checking = deferred(); const release = deferred();
  const getQuote = s.chain.getQuote.bind(s.chain);
  s.chain.getQuote = async (...args) => { checking.resolve(); await release.promise; return getQuote(...args); };
  let authentication: Promise<void> | undefined;
  try {
    authentication = s.authenticate(); await within(checking.promise, 'Quote lookup did not start');
    s.send({ type: 'heartbeat', mode: 'fail-mid', availableSlots: 2 });
    await delay(20);
    assert.equal(s.engine.models().length, 0);
    assert.deepEqual(s.messages.map(message => message.type), ['challenge']);
    release.resolve(); await authentication;
    await eventually(() => s.messages.some(message => message.type === 'heartbeat_ack'), 'Queued heartbeat did not run after authentication');
    assert.deepEqual(s.messages.map(message => message.type), ['challenge', 'authenticated', 'heartbeat_ack']);
    assert.equal(s.engine.providers.get('stream-seller')?.mode, 'fail-mid');
  } finally { release.resolve(); await authentication?.catch(() => {}); await s.close(); }
});

test('business messages before authentication close the socket without admitting a queued login', async () => {
  const s = await fixture(); let lookups = 0;
  s.chain.getQuote = async () => { lookups++; return quote; };
  try {
    const auth = await s.authenticationMessage(); const closed = once(s.socket, 'close');
    s.send({ type: 'chunk', requestId: 'unauthenticated', seq: 0, text: 'not admitted' });
    s.send(auth);
    const [code] = await within(closed, 'Unauthenticated business event did not close the connection');
    assert.equal(code, 4001); assert.equal(lookups, 0); assert.equal(s.engine.models().length, 0);
    assert.deepEqual(s.messages.map(message => message.type), ['challenge']);
  } finally { await s.close(); }
});

test('a failed signature cannot authenticate or process a queued heartbeat', async () => {
  const s = await fixture(); let lookups = 0;
  s.chain.getQuote = async () => { lookups++; return quote; };
  try {
    const invalid = await s.authenticationMessage('A different challenge'); const closed = once(s.socket, 'close');
    s.send(invalid); s.send({ type: 'heartbeat', mode: 'normal' });
    await within(closed, 'Invalid signature did not close the connection');
    assert.equal(lookups, 0); assert.equal(s.engine.models().length, 0);
    assert.ok(!s.messages.some(message => ['authenticated', 'heartbeat_ack'].includes(message.type)));
  } finally { await s.close(); }
});

test('disconnect during authentication does not register a late provider', async () => {
  const s = await fixture(); const checking = deferred(); const release = deferred();
  const getQuote = s.chain.getQuote.bind(s.chain); const addProvider = s.engine.addProvider.bind(s.engine); let registrations = 0;
  s.chain.getQuote = async (...args) => { checking.resolve(); await release.promise; return getQuote(...args); };
  s.engine.addProvider = async provider => { registrations++; await addProvider(provider); };
  try {
    s.send(await s.authenticationMessage()); await within(checking.promise, 'Quote lookup did not start');
    const closed = once(s.socket, 'close'); s.socket.close(); await within(closed, 'Fixture socket did not close');
    release.resolve(); await delay(20);
    assert.equal(registrations, 0); assert.equal(s.engine.models().length, 0);
    assert.ok(!s.messages.some(message => message.type === 'authenticated'));
  } finally { release.resolve(); await s.close(); }
});

test('an asynchronous business-event rejection closes the provider and refunds unfinished work', async () => {
  const s = await fixture();
  try {
    await s.authenticate(); const order = await s.engine.create(buyer, request);
    s.engine.providerEvent = async () => { await delay(1); throw new Error('Fixture event failed'); };
    const closed = once(s.socket, 'close'); s.send({ type: 'chunk', requestId: order.id, seq: 0, text: 'not accepted' });
    const [code] = await within(closed, 'Rejected event left the provider connected');
    assert.equal(code, 4003);
    await within(s.engine.waitForTerminal(order.id), 'Disconnect did not settle unfinished work');
    assert.equal(order.status, 'seller_failed'); assert.equal(order.charge, '0.000000000000000000');
    assert.equal(order.output, ''); assert.equal(order.settlement, 'confirmed'); assert.equal(s.engine.models().length, 0);
    assert.equal(s.messages.filter(message => message.type === 'rejected').length, 1);
  } finally { await s.close(); }
});
