import test from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiError, post } from './api';

test('API failures retain HTTP status so only 401 expires the wallet session', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch');
  fetch.mock.mockImplementation(async () => Response.json({ error: { message: 'Credential expired' } }, { status: 401 }));
  await assert.rejects(api('/account', 'test-session'), (error: unknown) => error instanceof ApiError && error.status === 401 && error.message === 'Credential expired');
  fetch.mock.mockImplementation(async () => new Response('Gateway failed', { status: 502 }));
  await assert.rejects(api('/account', 'test-session'), (error: unknown) => error instanceof ApiError && error.status === 502);
});

test('authenticated mutations preserve market confirmation and caller headers', async (t) => {
  const market = '0x0000000000000000000000000000000000001234';
  t.mock.method(globalThis, 'fetch', async (_url: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Authorization'), 'Bearer test-session');
    assert.equal(headers.get('X-InferPool-Market'), market);
    assert.equal(headers.get('Content-Type'), 'application/json');
    assert.equal(init?.method, 'POST');
    return new Response(null, { status: 204 });
  });
  assert.equal(await api('/v1/requests/test/cancel', 'test-session', { ...post({}), headers: { 'X-InferPool-Market': market } }), undefined);
});
