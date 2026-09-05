import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Store, type MarketIdentity, type State } from '../src/store.js';
import { Engine, type Provider, type RequestInput } from '../src/engine.js';
import { MemoryChain } from '../src/chain.js';
import { Auth } from '../src/auth.js';
import { createApp } from '../src/app.js';

const market: MarketIdentity = { market_address: '0x2222222222222222222222222222222222222222', asset_symbol: 'MON', asset_decimals: 18 };
const otherMarket = '0x1111111111111111111111111111111111111111';
const buyer = '0x3333333333333333333333333333333333333333';
const secondBuyer = '0x4444444444444444444444444444444444444444';
const thirdBuyer = '0x5555555555555555555555555555555555555555';
const input: RequestInput = { model: 'mock', messages: [{ role: 'user', content: 'hi' }], max_tokens: 2, max_spend: '0.001' };

async function fixture(store = new Store()) {
  const chain = Object.assign(new MemoryChain(), { market: market.market_address });
  const calls = { lock: 0, settle: 0 };
  const lock = chain.lock.bind(chain); const settle = chain.settle.bind(chain);
  chain.lock = async value => { calls.lock++; return lock(value); };
  chain.settle = async value => { calls.settle++; return settle(value); };
  for (const wallet of [buyer, secondBuyer, thirdBuyer]) chain.fund(wallet, '1');
  const quote = { input: '0.3', cacheRead: '0.03', cacheWrite: '0.375', output: '0.8', minReserve: '0.000001' };
  chain.quote(buyer, input.model, quote);
  const engine = new Engine(chain, store, 30_000);
  const provider: Provider = { id: 'seller', wallet: buyer, name: 'seller', model: input.model, quote, capacity: 2, busy: 0, mode: 'normal', mock: true, send: () => {} };
  await engine.addProvider(provider);
  return { store, chain, engine, provider, calls, auth: new Auth(store, 'localhost') };
}

test('unbound records and even zero-order API keys cannot be relabeled as native MON', () => {
  for (const kind of ['order', 'key'] as const) {
    const store = new Store();
    if (kind === 'order') store.state.orders.old = { id: 'old', buyer, status: 'completed', settlement: 'confirmed', charge: '0.014160', createdAt: Date.now() };
    else new Auth(store, 'localhost').issue(buyer, 'api-key', 'unbound', Date.now() + 60_000);
    const before = JSON.stringify(store.state);
    assert.throws(() => store.bindMarket(market), /Unbound nonempty ledger/);
    assert.equal(JSON.stringify(store.state), before);
  }
});

test('wrong market, partial order identity and foreign API keys fail before ledger mutation', () => {
  const scenarios: ((state: State) => void)[] = [
    state => { state.market = { ...market, market_address: otherMarket }; },
    state => { state.market = { ...market, asset_decimals: 6 }; },
    state => { state.orders.bad = { id: 'bad', buyer, market_address: market.market_address }; },
    state => { state.orders.bad = { id: 'bad', buyer, ...market, market_address: otherMarket }; },
    state => { state.orders.bad = { id: 'bad', buyer, ...market, asset_symbol: 'UNKNOWN' }; },
    state => { Object.values(state.credentials)[0]!.market_address = otherMarket; },
    state => { delete Object.values(state.credentials)[0]!.market_address; },
  ];
  for (const scenario of scenarios) {
    const store = new Store(); store.bindMarket(market);
    new Auth(store, 'localhost').issue(buyer, 'api-key', 'native', Date.now() + 60_000);
    scenario(store.state); const before = JSON.stringify(store.state);
    assert.throws(() => store.bindMarket(market), /different market|identity does not match/);
    assert.equal(JSON.stringify(store.state), before);
  }
});

test('stored historical attempts retain wallet and timestamp integrity checks', () => {
  const invalid: unknown[] = [{}, [{ buyer: 'not-an-address', createdAt: Date.now() }], [{ buyer, createdAt: 0 }], [{ buyer, createdAt: -1 }], [{ buyer, createdAt: 0.5 }], [{ buyer, createdAt: Number.MAX_SAFE_INTEGER + 1 }]];
  for (const history of invalid) {
    const store = new Store(); store.state.admissionHistory = history as State['admissionHistory'];
    const before = JSON.stringify(store.state);
    assert.throws(() => store.bindMarket(market), /Invalid admission history/);
    assert.equal(JSON.stringify(store.state), before);
  }
});

test('new API keys are bound to the current market and wallet sessions keep their separate role', () => {
  const store = new Store(); store.bindMarket(market); const auth = new Auth(store, 'localhost');
  const key = auth.issue(buyer, 'api-key', 'MON', Date.now() + 60_000);
  const credential = auth.authenticate(`Bearer ${key.token}`);
  assert.equal(credential.market_address, market.market_address);
  assert.ok(!JSON.stringify(store.state).includes(key.token));
  assert.doesNotThrow(() => auth.requireCurrentMarket(credential));
  assert.throws(() => auth.requireSession(credential), /Wallet session required/);
  for (const market_address of [undefined, otherMarket]) assert.throws(() => auth.requireCurrentMarket({ ...credential, market_address }), /does not belong/);
  const session = auth.issue(buyer, 'session', 'wallet', Date.now() + 60_000);
  assert.doesNotThrow(() => auth.requireSession(auth.authenticate(`Bearer ${session.token}`)));
  store.bindMarket(market); assert.equal(auth.authenticate(`Bearer ${key.token}`).market_address, market.market_address);
});

test('historical wallet attempts persist across restart without preventing a current-market API key request', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'inferpool-native-ledger-'));
  const path = join(directory, 'ledger.json'); const createdAt = Date.now(); const store = new Store(path);
  store.state.admissionHistory = Array.from({ length: 15 }, () => ({ buyer, createdAt })); store.bindMarket(market);
  const s = await fixture(new Store(path));
  try {
    const key = s.auth.issue(buyer, 'api-key', 'fresh key', Date.now() + 60_000);
    s.auth.requireCurrentMarket(s.auth.authenticate(`Bearer ${key.token}`));
    const order = await s.engine.create(buyer, input, 'new-key');
    assert.equal(order.status, 'running'); assert.equal(order.market_address, market.market_address);
    assert.deepEqual(s.calls, { lock: 1, settle: 0 }); assert.equal(s.chain.orders.size, 1);
    assert.deepEqual(new Store(path).state.admissionHistory, store.state.admissionHistory);
    assert.equal(Object.keys(new Store(path).state.orders).length, 1);
    assert.equal(Object.keys(new Store(path).state.credentials).length, 1);
  } finally { s.engine.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('historical global attempts do not prevent another funded wallet from reserving and dispatching', async () => {
  const createdAt = Date.now(); const store = new Store();
  store.state.admissionHistory = Array.from({ length: 15 }, (_, i) => ({ buyer: i < 8 ? buyer : secondBuyer, createdAt }));
  const s = await fixture(store);
  let dispatched = 0; s.provider.send = () => { dispatched++; };
  try {
    const order = await s.engine.create(thirdBuyer, input, 'new-order');
    assert.equal(order.status, 'running');
    assert.deepEqual(s.calls, { lock: 1, settle: 0 }); assert.equal(dispatched, 1);
    assert.equal(s.store.state.admissionHistory!.length, 15); assert.equal(Object.keys(s.store.state.orders).length, 1);
  } finally { s.engine.close(); }
});

test('historical attempts remain unchanged while native orders and exact replay retain their identities', async () => {
  const createdAt = Date.now(); const store = new Store();
  store.state.admissionHistory = Array.from({ length: 12 }, () => ({ buyer, createdAt }));
  const history = structuredClone(store.state.admissionHistory);
  const s = await fixture(store);
  try {
    const order = await s.engine.create(buyer, input, 'first');
    await s.engine.providerEvent(s.provider, { type: 'completed', requestId: order.id, seq: 0 });
    assert.equal(order.asset_symbol, 'MON'); assert.equal(order.settlement, 'confirmed');
    assert.equal((await s.engine.create(buyer, input, 'first')).id, order.id);
    const second = await s.engine.create(buyer, input, 'second');
    assert.notEqual(second.id, order.id); assert.equal(second.status, 'running');
    assert.deepEqual(s.calls, { lock: 2, settle: 1 });
    assert.deepEqual(s.store.state.admissionHistory, history); assert.equal(Object.keys(s.store.state.orders).length, 2);
  } finally { s.engine.close(); }
});

test('stale wallet sessions must explicitly name the current market for request and cancellation POSTs', async () => {
  const s = await fixture();
  const server = createServer(createApp(s.engine, s.auth, { allowedOrigins: ['https://app.example'] }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const session = s.auth.issue(buyer, 'session', 'retained wallet session', Date.now() + 60_000);
  const headers = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };
  const staleHeaders: Record<string, string>[] = [{}, { 'X-InferPool-Market': otherMarket }];
  const post = (path: string, body: unknown, extra: Record<string, string> = {}) => fetch(url + path, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
  try {
    for (const extra of staleHeaders) {
      const response = await post('/v1/chat/completions', input, extra);
      assert.equal(response.status, 409); assert.match((await response.json()).error.message, /confirm the current MON market/);
    }
    assert.deepEqual(s.calls, { lock: 0, settle: 0 });
    assert.equal((await fetch(url + '/account', { headers })).status, 200);
    const preflight = await fetch(url + '/v1/chat/completions', { method: 'OPTIONS', headers: { Origin: 'https://app.example', 'Access-Control-Request-Headers': 'x-inferpool-market' } });
    assert.match(preflight.headers.get('access-control-allow-headers')!, /X-InferPool-Market/);

    const order = await s.engine.create(buyer, input, 'current-order');
    for (const extra of staleHeaders) {
      assert.equal((await post(`/v1/requests/${order.id}/cancel`, {}, extra)).status, 409);
      assert.equal(order.status, 'running'); assert.equal(s.calls.settle, 0);
    }
    const cancelled = await post(`/v1/requests/${order.id}/cancel`, {}, { 'X-InferPool-Market': s.engine.marketIdentity.market_address });
    assert.equal(cancelled.status, 200); assert.equal((await cancelled.json()).status, 'buyer_cancelled');

    const next = await s.engine.create(buyer, input, 'api-key-order');
    const key = s.auth.issue(buyer, 'api-key', 'current MON key', Date.now() + 60_000);
    const keyCancelled = await post(`/v1/requests/${next.id}/cancel`, {}, { Authorization: `Bearer ${key.token}` });
    assert.equal(keyCancelled.status, 200); assert.equal((await keyCancelled.json()).status, 'buyer_cancelled');
  } finally {
    s.engine.close(); server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
