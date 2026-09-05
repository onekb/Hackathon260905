import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { privateKeyToAccount } from 'viem/accounts';
import { createApp } from '../src/app.js';
import { Auth } from '../src/auth.js';
import { Engine, type Provider } from '../src/engine.js';
import { MemoryChain } from '../src/chain.js';
import { Store } from '../src/store.js';
import { attachProviderHub } from '../src/provider-hub.js';
import { resolveWebStaticDir } from '../src/static-web.js';

async function files() {
  const base = await mkdtemp(join(tmpdir(), 'inferpool-static-'));
  const root = join(base, 'out');
  for (const path of ['', 'provider-connect', '_next/static', 'auth', 'v1', 'empty', 'escape-index']) await mkdir(join(root, path), { recursive: true });
  for (const [path, text] of Object.entries({ 'index.html': '<!doctype html><h1>Market</h1>', 'provider-connect/index.html': '<!doctype html><h1>Provider connect</h1>', '_next/static/app.js': 'console.log("public asset")', 'auth/missing.html': 'Must not replace API', 'v1/missing.html': 'Must not replace API', '.env': 'PRIVATE FIXTURE' })) await writeFile(join(root, path), text);
  await writeFile(join(base, 'private.txt'), 'PRIVATE FIXTURE');
  await symlink(join(base, 'private.txt'), join(root, 'escape.txt'));
  await symlink(base, join(root, 'escape-dir'));
  await symlink(join(base, 'private.txt'), join(root, 'escape-index/index.html'));
  return { base, root, close: () => rm(base, { recursive: true, force: true }) };
}

async function fixture(directory?: string) {
  const chain = new MemoryChain(); const store = new Store(); const engine = new Engine(chain, store);
  const auth = new Auth(store, 'router.test');
  const server = createServer(createApp(engine, auth, { allowedOrigins: [], webStaticDir: directory }));
  const wss = attachProviderHub(server, engine, 'router.test');
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  return { url, chain, engine, auth,
    raw: (path: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = httpRequest(url, { path }, res => { let body = ''; res.setEncoding('utf8'); res.on('data', part => { body += part; }); res.on('end', () => resolve({ status: res.statusCode!, body })); });
      req.on('error', reject); req.end();
    }),
    close: async () => { for (const client of wss.clients) client.terminate(); await new Promise<void>(resolve => wss.close(() => resolve())); engine.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); },
  };
}

test('static export configuration is opt-in, absolute and validates the entry before startup', async () => {
  const f = await files();
  try {
    assert.equal(resolveWebStaticDir(undefined), undefined);
    assert.throws(() => resolveWebStaticDir(''));
    assert.throws(() => resolveWebStaticDir('web/out'));
    assert.throws(() => resolveWebStaticDir(join(f.base, 'missing')));
    assert.throws(() => resolveWebStaticDir(join(f.root, 'index.html')));
    assert.throws(() => resolveWebStaticDir(join(f.root, 'empty')));
    assert.throws(() => resolveWebStaticDir(join(f.root, 'escape-index')));
    assert.ok(resolveWebStaticDir(f.root)?.endsWith('/out'));
  } finally { await f.close(); }
});

test('without WEB_STATIC_DIR the existing API remains available and no Web is served', async () => {
  const s = await fixture();
  try { assert.equal((await fetch(`${s.url}/`)).status, 404); assert.equal((await fetch(`${s.url}/health`)).status, 200); }
  finally { await s.close(); }
});

test('one HTTP port serves export routes, static assets and HEAD without replacing APIs', async () => {
  const f = await files(); const s = await fixture(f.root);
  try {
    const home = await fetch(`${s.url}/`); assert.equal(home.status, 200); assert.match(home.headers.get('content-type')!, /text\/html/); assert.match(await home.text(), /Market/);
    const redirect = await fetch(`${s.url}/provider-connect?node_origin=example`, { redirect: 'manual' }); assert.equal(redirect.status, 301); assert.equal(redirect.headers.get('location'), '/provider-connect/?node_origin=example');
    const popup = await fetch(`${s.url}/provider-connect/`); assert.equal(popup.status, 200); assert.match(await popup.text(), /Provider connect/);
    const asset = await fetch(`${s.url}/_next/static/app.js`); assert.equal(asset.status, 200); assert.match(asset.headers.get('content-type')!, /javascript/); assert.match(await asset.text(), /public asset/);
    const head = await fetch(`${s.url}/_next/static/app.js`, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '');
    assert.equal((await (await fetch(`${s.url}/health`)).json()).chain_mode, 'memory');
    assert.deepEqual((await (await fetch(`${s.url}/v1/models`)).json()).data, []);
    assert.equal((await fetch(`${s.url}/account`)).status, 401);
    for (const path of ['/auth/missing.html', '/v1/missing.html', '/%76%31/missing.html', '/provider', '/config/unknown', '/not-a-page', '/empty/']) {
      const response = await fetch(`${s.url}${path}`); assert.equal(response.status, 404, path); assert.match(response.headers.get('content-type')!, /application\/json/); assert.equal((await response.json()).error.message, 'Not found');
    }
    assert.equal((await fetch(`${s.url}/index.html`, { method: 'POST' })).status, 404);
  } finally { await s.close(); await f.close(); }
});

test('static paths deny dotfiles, traversal and symlink escapes, including directory indexes', async () => {
  const f = await files(); const s = await fixture(f.root);
  try {
    for (const path of ['/.env', '/%2eenv', '/%2e%2e/private.txt', '/../private.txt', '/..%5cprivate.txt', '/escape.txt', '/escape-dir/private.txt', '/escape-index/', '/escape-index', '/index.html%00']) {
      const response = await s.raw(path); assert.equal(response.status, 404, path); assert.ok(!response.body.includes('PRIVATE FIXTURE'), path);
    }
    assert.equal((await s.raw('/%not-hex')).status, 400);
  } finally { await s.close(); await f.close(); }
});

test('provider WebSocket authentication still upgrades on the shared static/API port', async () => {
  const f = await files(); const s = await fixture(f.root);
  const account = privateKeyToAccount(`0x${'11'.repeat(32)}`);
  const pricing = { input: '1', cacheRead: '0.1', cacheWrite: '2', output: '1', minReserve: '0.001' };
  s.chain.quote(account.address, 'mock-reasoner', pricing);
  const socket = new WebSocket(s.url.replace('http:', 'ws:') + '/provider');
  try {
    const [raw] = await once(socket, 'message'); const challenge = JSON.parse(raw.toString()); assert.equal(challenge.type, 'challenge');
    const authenticated = once(socket, 'message');
    socket.send(JSON.stringify({ type: 'auth', address: account.address, signature: await account.signMessage({ message: challenge.message }), mock: true, provider: { id: 'static-test', modelId: 'mock-reasoner', capacity: 1, pricing } }));
    const [reply] = await authenticated; assert.equal(JSON.parse(reply.toString()).type, 'authenticated');
    assert.equal((await (await fetch(`${s.url}/v1/models`)).json()).data.length, 1);
    assert.match(await (await fetch(`${s.url}/`)).text(), /Market/);
  } finally { socket.terminate(); await s.close(); await f.close(); }
});

test('SSE delivers output before completion while static routes share the port', async () => {
  const f = await files(); const s = await fixture(f.root);
  const buyer = '0x1111111111111111111111111111111111111111';
  const seller = '0x2222222222222222222222222222222222222222';
  const quote = { input: '0', cacheRead: '0', cacheWrite: '0', output: '1', minReserve: '0.001' };
  const provider: Provider = { id: 'sse-test', wallet: seller, name: 'Test', model: 'mock-reasoner', quote, capacity: 1, busy: 0, mode: 'normal', mock: true, send: () => {} };
  s.chain.fund(buyer); s.chain.quote(seller, provider.model, quote); await s.engine.addProvider(provider);
  const { token } = s.auth.issue(buyer, 'session', 'in-memory test', Date.now() + 60_000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(`${s.url}/v1/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-InferPool-Market': s.engine.marketIdentity.market_address }, body: JSON.stringify({ model: provider.model, messages: [{ role: 'user', content: 'hello' }], max_tokens: 20, max_spend: '0.1', stream: true }) });
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type')!, /text\/event-stream/); assert.equal(response.headers.get('x-accel-buffering'), 'no');
    const id = response.headers.get('x-request-id')!; reader = response.body!.getReader(); const decoder = new TextDecoder();
    assert.match(decoder.decode((await reader.read()).value), /event: request/);
    await s.engine.providerEvent(provider, { type: 'chunk', requestId: id, seq: 0, text: 'streamed' });
    assert.match(decoder.decode((await reader.read()).value), /streamed/); assert.equal(s.engine.get(id, buyer).status, 'running');
    assert.equal((await fetch(`${s.url}/provider-connect/`)).status, 200);
    await s.engine.providerEvent(provider, { type: 'completed', requestId: id, seq: 1 });
    let rest = ''; for (;;) { const part = await reader.read(); if (part.done) break; rest += decoder.decode(part.value); }
    assert.match(rest, /\[DONE\]/); assert.equal(s.engine.get(id, buyer).settlement, 'confirmed'); assert.equal(s.chain.orders.size, 1);
  } finally { await reader?.cancel(); await s.close(); await f.close(); }
});
