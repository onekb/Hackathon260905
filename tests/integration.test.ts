import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { EvmChain } from '../server/src/evm-chain.js';
import { Engine } from '../server/src/engine.js';
import { Store } from '../server/src/store.js';
import { Auth } from '../server/src/auth.js';
import { createApp } from '../server/src/app.js';
import { attachProviderHub } from '../server/src/provider-hub.js';
import { ProviderClient } from '../provider/src/client.js';
import { parseConfig } from '../provider/src/config.js';
import { units } from '../server/src/money.js';
import { deployFixture, rpcUrl } from './fixture.js';

async function eventually(predicate: () => boolean, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Expected state was not reached before the test deadline');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test('HTTP API + two signed outbound seller connections + real EVM settlement', { timeout: 30_000 }, async () => {
  const f = await deployFixture();
  const chain = new EvmChain({ mode: 'anvil', rpcUrl, marketAddress: f.market, routerAddress: f.router });
  await chain.ready();
  const store = new Store();
  const engine = new Engine(chain, store, 1500);
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  const auth = new Auth(store, `127.0.0.1:${port}`);
  server.on('request', createApp(engine, auth, { allowedOrigins: [origin] }));
  const hub = attachProviderHub(server, engine, `127.0.0.1:${port}`);
  const nodes = [2, 3].map((index, i) => new ProviderClient(parseConfig(['--router', `ws://127.0.0.1:${port}/provider`, '--id', `seller-${i + 1}`, '--model', f.model, '--interval-ms', '4', '--chunk-size', '8', '--min-reserve', '0.0001'], {}), f.accounts[index]!));
  try {
    nodes.forEach(node => node.online());
    await eventually(() => engine.providers.size === 2 && nodes.every(node => node.snapshot().status === 'online'));
    const json = async (path: string, body?: unknown, token?: string, extra: Record<string, string> = {}) => {
      const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const data = await response.json();
      assert.ok(response.ok, `${path} status=${response.status} ${JSON.stringify(data)}`);
      return data;
    };
    const c = await json('/auth/challenge', { wallet: f.buyer });
    const signed = await f.accounts[1]!.signMessage({ message: c.message });
    const session = await json('/auth/verify', { wallet: f.buyer, nonce: c.nonce, signature: signed });
    const key = await json('/api-keys', { name: 'integration', expires_in_days: 1 }, session.token);
    assert.equal(Object.values(store.state.credentials).some((credential: any) => JSON.stringify(credential).includes(key.token)), false);
    const body = { model: f.model, messages: [{ role: 'user', content: '演示按用量结算' }], max_tokens: 1000, max_spend: '0.1', provider_id: 'seller-1' };
    const idem = randomUUID();
    const completed = await json('/v1/chat/completions', body, key.token, { 'Idempotency-Key': idem });
    assert.equal(completed.request.status, 'completed');
    assert.equal(completed.request.settlement, 'confirmed');
    assert.ok(units(completed.request.charge) > 0n);
    assert.match(completed.request.settlementTx, /^0x[0-9a-f]{64}$/i);
    const balance = (await chain.getAccount(f.buyer)).available;
    const repeat = await json('/v1/chat/completions', body, key.token, { 'Idempotency-Key': idem });
    assert.equal(repeat.id, completed.id);
    assert.equal((await chain.getAccount(f.buyer)).available, balance);
    const collision = await fetch(origin + '/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.token}`, 'Idempotency-Key': idem }, body: JSON.stringify({ ...body, max_spend: '0.2' }) });
    assert.equal(collision.status, 409);

    nodes[0]!.setMode('fail-mid');
    await eventually(() => engine.providers.get('seller-1')?.mode === 'fail-mid');
    const beforeFailure = (await chain.getAccount(f.buyer)).available;
    const failed = await json('/v1/chat/completions', body, key.token);
    assert.equal(failed.request.status, 'seller_failed');
    assert.ok(failed.request.usage.output > 0);
    assert.equal(failed.request.charge, '0.000000');
    assert.equal(failed.request.released, '0.100000');
    assert.equal((await chain.getAccount(f.buyer)).available, beforeFailure);

    nodes[0]!.setMode('normal');
    await eventually(() => engine.providers.get('seller-1')?.mode === 'normal');
    const stream = await fetch(origin + '/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.token}` }, body: JSON.stringify({ ...body, stream: true }) });
    assert.equal(stream.status, 200);
    assert.match(stream.headers.get('content-type')!, /text\/event-stream/);
    const id = stream.headers.get('x-request-id')!;
    await eventually(() => engine.get(id).usage.output > 0);
    const cancelled = await json(`/v1/requests/${id}/cancel`, {}, key.token);
    assert.equal(cancelled.status, 'buyer_cancelled');
    assert.ok(units(cancelled.charge) > 0n && units(cancelled.charge) < units(cancelled.budget));
    const sse = await stream.text();
    assert.ok(sse.includes('data: [DONE]'));
    assert.ok(sse.includes('event: request'));

    const capped = await json('/v1/chat/completions', { ...body, max_spend: '0.004' }, key.token);
    assert.equal(capped.request.status, 'budget_capped');
    assert.ok(units(capped.request.charge) <= 4000n);
    const warm = await json('/v1/chat/completions', { ...body, cache: true }, key.token);
    const hit = await json('/v1/chat/completions', { ...body, cache: true }, key.token);
    assert.ok(warm.request.usage.cacheWrite > 0);
    assert.ok(hit.request.usage.cacheRead > 0);
    assert.equal(hit.request.usage.input + hit.request.usage.cacheWrite, 0);
    const other = await json('/v1/chat/completions', { ...body, cache: true, provider_id: 'seller-2' }, key.token);
    assert.ok(other.request.usage.cacheWrite > 0);
    assert.equal(other.request.usage.cacheRead, 0);

    nodes[0]!.setMode('timeout');
    await eventually(() => engine.providers.get('seller-1')?.mode === 'timeout');
    const timedOut = await json('/v1/chat/completions', body, key.token);
    assert.equal(timedOut.request.status, 'seller_failed');
    assert.equal(timedOut.request.charge, '0.000000');
    const forbidden = await fetch(origin + '/v1/requests/' + completed.id);
    assert.equal(forbidden.status, 401);
    const keysForbidden = await fetch(origin + '/api-keys', { headers: { Authorization: `Bearer ${key.token}` } });
    assert.equal(keysForbidden.status, 403);
    const listed = await json('/v1/requests', undefined, key.token);
    assert.ok(listed.data.every((order: any) => order.settlement === 'confirmed'));
  } finally {
    nodes.forEach(node => node.offline());
    engine.close();
    hub.clients.forEach(socket => socket.terminate());
    await new Promise<void>(resolve => hub.close(() => resolve()));
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
