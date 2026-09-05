import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBrowserProviderChallenge, parseBrowserProviderInfo, parseLoopbackOrigin } from '../../shared/browser-wallet.js';

const origin = 'http://127.0.0.1:8794';
const router = 'http://127.0.0.1:8788';
const now = 1_788_582_000_000;
const expiry = now + 60_000;
const challenge = {
  type: 'inferpool:provider-challenge', requestId: 'browser-provider-request-01', expiresAt: expiry,
  message: `InferPool provider authentication\nDomain: 127.0.0.1:8788\nNonce: ${'a'.repeat(48)}\nExpires: ${expiry}\nThis signature authenticates this session only. It does not authorize token transfers.`,
};

test('browser signing accepts only a loopback origin with a fixed port', () => {
  assert.equal(parseLoopbackOrigin(origin), origin);
  for (const value of ['http://127.0.0.1:8794/path', 'http://127.0.0.1:8794?token=x', 'http://evil.example:8794', 'http://localhost', 'http://user@localhost:8794', 'http://127.0.0.1:8794#x', 'https://localhost:8794']) {
    assert.throws(() => parseLoopbackOrigin(value));
  }
});

test('browser signing pins node and router origins and validates its receiving wallet', () => {
  const info = { type: 'inferpool:provider-info', nodeOrigin: origin, routerOrigin: router, providerId: 'seller-para', wallet: '0xbc81a46f5eee3924aa0b7fd8849ea08351194a75' };
  assert.equal(parseBrowserProviderInfo(info, origin, router).wallet.toLowerCase(), info.wallet);
  for (const patch of [{ nodeOrigin: 'http://localhost:8794' }, { routerOrigin: 'http://attacker.example' }, { wallet: 'invalid' }, { providerId: '../seller' }]) {
    assert.throws(() => parseBrowserProviderInfo({ ...info, ...patch }, origin, router));
  }
});

test('browser signing refuses altered purpose, domain, expiry, nonce and appended transfer messages', () => {
  assert.equal(parseBrowserProviderChallenge(challenge, router, now).nonce, 'a'.repeat(48));
  for (const candidate of [
    { ...challenge, message: challenge.message.replace('provider authentication', 'buyer authentication') },
    { ...challenge, message: challenge.message.replace('127.0.0.1:8788', 'attacker.example') },
    { ...challenge, message: `${challenge.message}\nApprove unlimited token transfers.` },
    { ...challenge, expiresAt: expiry + 1 },
    { ...challenge, message: challenge.message.replace('a'.repeat(48), 'short-nonce') },
    { ...challenge, message: challenge.message.replaceAll('\n', '\r\n') },
  ]) assert.throws(() => parseBrowserProviderChallenge(candidate, router, now));
  assert.throws(() => parseBrowserProviderChallenge(challenge, router, expiry));
  assert.throws(() => parseBrowserProviderChallenge(challenge, router, expiry - 300_001));
});
