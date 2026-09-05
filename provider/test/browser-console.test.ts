import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const settle = () => new Promise<void>(resolve => setImmediate(resolve));
async function fixture() {
  const listeners = new Map<string, (event: any) => void>();
  const elements = new Map<string, any>();
  const intervalCallbacks: (() => void)[] = [];
  const popupMessages: { message: any; origin: string }[] = [];
  const calls: { path: string; options?: any }[] = [];
  const popup = { closed: false, postMessage: (message: any, origin: string) => popupMessages.push({ message, origin }) };
  const wallet = '0x1111111111111111111111111111111111111111';
  const nodeOrigin = 'http://127.0.0.1:8794';
  const uiOrigin = 'http://127.0.0.1:3000';
  let state: any = { name: 'Browser Seller', providerId: 'seller-b', modelId: 'mock-reasoner', wallet, walletMode: 'browser-wallet', walletUi: uiOrigin, router: 'ws://127.0.0.1:8788/provider', routerOrigin: 'http://127.0.0.1:8788', status: 'offline', enabled: false, active: 0, capacity: 2, availableSlots: 2, chunkSize: 4, intervalMs: 80, pricing: {}, requests: [], mode: 'normal', browserWallet: { status: 'waiting', error: null } };
  const pending = { requestId: 'test-request', message: 'test provider challenge', expiresAt: Date.now() + 60_000 };
  let opened = '';
  function element(id: string): any {
    if (!elements.has(id)) elements.set(id, { listeners: new Map(), classList: { toggle() {} }, addEventListener(type: string, handler: any) { this.listeners.set(type, handler); }, replaceChildren() {}, insertRow() { return { insertCell: () => ({}) }; }, elements: { namedItem: () => ({ value: '' }) } });
    return elements.get(id);
  }
  const context = {
    document: { getElementById: element, querySelector: () => ({ content: 'local-csrf-token' }), activeElement: null },
    location: { origin: nodeOrigin },
    window: { addEventListener: (type: string, handler: any) => listeners.set(type, handler), open: (url: string) => { opened = url; return popup; } },
    setTimeout: () => 0, setInterval: (fn: () => void) => { intervalCallbacks.push(fn); return 1; },
    fetch: async (path: string, options?: any) => {
      calls.push({ path, options });
      if (options?.method === 'POST') {
        assert.equal(options.headers['X-Provider-Control'], 'local-csrf-token');
        assert.ok(path.startsWith('/api/'));
      }
      if (path === '/api/browser/ready') state = { ...state, status: 'authenticating', enabled: true, browserWallet: { status: 'signing', error: null } };
      if (path === '/api/browser/signature') state = { ...state, status: 'online', browserWallet: { status: 'signed', error: null } };
      if (path === '/api/offline') state = { ...state, status: 'offline', enabled: false };
      return { ok: true, json: async () => path === '/api/browser/challenge' ? { challenge: pending } : state };
    },
  };
  runInNewContext(await readFile(new URL('../public/app.js', import.meta.url), 'utf8'), context);
  await settle();
  const message = (data: any, origin = uiOrigin, source: any = popup) => listeners.get('message')!({ data, origin, source });
  const click = () => element('browser-connect').listeners.get('click')();
  return { calls, popupMessages, popup, wallet, nodeOrigin, uiOrigin, message, click, opened: () => opened, tick: () => intervalCallbacks.forEach(fn => fn()), hide: () => listeners.get('pagehide')!({}) };
}

test('console allows only exact popup and fixed UI origin; popup-ready carries no credentials or signing authority', async () => {
  const f = await fixture();
  f.click(); assert.equal(f.opened(), `${f.uiOrigin}/provider-connect?node_origin=${encodeURIComponent(f.nodeOrigin)}`);
  f.message({ type: 'inferpool:wallet-ready', wallet: f.wallet }, 'https://evil.invalid');
  f.message({ type: 'inferpool:wallet-ready', wallet: f.wallet }, f.uiOrigin, {});
  f.message({ type: 'inferpool:popup-ready' }, 'https://evil.invalid');
  await settle();
  assert.equal(f.calls.filter(call => call.options?.method === 'POST').length, 0);
  assert.equal(f.popupMessages.length, 0);
  f.message({ type: 'inferpool:popup-ready' }); await settle();
  assert.equal(f.popupMessages[0]?.message.type, 'inferpool:provider-info');
  assert.equal(f.popupMessages[0]?.origin, f.uiOrigin);
  assert.equal(f.popupMessages[0]?.message.nodeOrigin, f.nodeOrigin);
  assert.ok(!JSON.stringify(f.popupMessages).includes('local-csrf-token'));
  assert.equal(f.calls.filter(call => call.options?.method === 'POST').length, 0);
});

test('console accepts one explicit ready and matching signature; popup closure invalidates later replies and takes node offline', async () => {
  const f = await fixture(); f.click();
  f.message({ type: 'inferpool:wallet-ready', wallet: '0x2222222222222222222222222222222222222222' });
  await settle(); assert.equal(f.calls.filter(call => call.path === '/api/browser/ready').length, 0);
  f.message({ type: 'inferpool:wallet-ready', wallet: f.wallet });
  f.message({ type: 'inferpool:wallet-ready', wallet: f.wallet });
  await settle(); await settle();
  assert.equal(f.calls.filter(call => call.path === '/api/browser/ready').length, 1);
  assert.equal(f.popupMessages.filter(item => item.message.type === 'inferpool:provider-challenge').length, 1);
  f.message({ type: 'inferpool:provider-signature', requestId: 'wrong', signature: '0x123' });
  await settle(); assert.equal(f.calls.filter(call => call.path === '/api/browser/signature').length, 0);
  const signed = { type: 'inferpool:provider-signature', requestId: 'test-request', signature: '0x123' };
  f.message(signed); f.message(signed); await settle();
  assert.equal(f.calls.filter(call => call.path === '/api/browser/signature').length, 1);
  f.popup.closed = true; f.tick(); await settle(); await settle();
  assert.equal(f.calls.filter(call => call.path === '/api/offline').length, 1);
  f.message(signed); await settle();
  assert.equal(f.calls.filter(call => call.path === '/api/browser/signature').length, 1);
});

test('console pagehide cleans up through same-origin CSRF POST with keepalive and ignores delayed wallet-ready', async () => {
  const f = await fixture(); f.click(); f.hide(); await settle();
  const call = f.calls.find(call => call.path === '/api/offline');
  assert.equal(call?.options.keepalive, true);
  assert.equal(call?.options.headers['X-Provider-Control'], 'local-csrf-token');
  f.message({ type: 'inferpool:wallet-ready', wallet: f.wallet }); await settle();
  assert.equal(f.calls.filter(call => call.path === '/api/browser/ready').length, 0);
});
