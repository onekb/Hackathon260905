import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPairSync, verify as verifyProof } from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { alchemyWalletApiBase, createAlchemySessionAccount, createAlchemyBuyerSessionAccount, createProviderAccount, ProviderSigningError, type SessionResolver } from '../src/signer.js';
import { parseConfig } from '../src/config.js';

function fixture(options: { invalidMethod?: boolean; wrongSigner?: boolean } = {}) {
  const wallet = privateKeyToAccount(generatePrivateKey());
  const delegated = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  let session: any = {
    sessionId: 'cc7b14b9-ffcb-4605-980c-46f9b720f0ad', walletId: 'wallet-test', evmAddress: wallet.address,
    status: 'approved', expiresAt: new Date(Date.now() + 60000).toISOString(),
    privateKeyPem: delegated.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    privySignerId: 'delegated-signer-test', capabilities: { 'evm.signMessage': true },
  };
  const originalSession = session;
  const token = 'test-only-session-auth';
  const resolver: SessionResolver = { resolveWalletSession: () => session, resolveAuthToken: () => token };
  const calls: { url: string; body: Record<string, any> }[] = [];
  let signText = '';
  const mockFetch: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body));
    calls.push({ url: String(url), body });
    assert.equal(init?.redirect, 'error');
    assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${token}`);
    assert.doesNotMatch(JSON.stringify(body), /PRIVATE KEY|privateKeyPem/);
    if (String(url).endsWith('/challenge')) {
      signText = body.message;
      assert.equal(body.providerSignerId, 'delegated-signer-test');
      assert.equal(body.encoding, 'utf-8');
      return Response.json({ data: { challengeId: 'challenge-test', challenge: 'session-proof-challenge', expiresAt: new Date(Date.now() + 60000).toISOString(), method: options.invalidMethod ? 'eth_signTransaction' : 'personal_sign', walletAddress: wallet.address, walletId: 'wallet-test' } });
    }
    assert.ok(String(url).endsWith('/complete'));
    assert.ok(verifyProof('sha256', Buffer.from('session-proof-challenge'), delegated.publicKey, Buffer.from(body.signature, 'base64url')));
    const signer = options.wrongSigner ? privateKeyToAccount(generatePrivateKey()) : wallet;
    return Response.json({ data: { signature: await signer.signMessage({ message: signText }), encoding: 'hex' } });
  };
  return { wallet, resolver, mockFetch, calls, originalSession, replaceSession: (next: any) => { session = next; } };
}

const message = 'InferPool provider authentication\nDomain: 127.0.0.1:8788\nNonce: one-time-provider-nonce\nExpires: 9999999999999\nThis signature authenticates this session only.';

test('session adapter signs only message authentication with delegated proof and validates signer', async () => {
  const f = fixture();
  const account = await createAlchemySessionAccount({ loadResolver: async () => f.resolver, fetch: f.mockFetch, env: {} });
  assert.equal(account.address, f.wallet.address);
  assert.equal('signTransaction' in account, false);
  assert.equal('privateKey' in account, false);
  assert.match(await account.signMessage({ message }), /^0x[0-9a-f]{130}$/i);
  assert.deepEqual(f.calls.map((call) => new URL(call.url).pathname), ['/wallet/evm/sign-message/challenge', '/wallet/evm/sign-message/complete']);
});

test('inactive, expired or capability-denied session fails without fallback or network signing', async () => {
  const f = fixture();
  for (const session of [null, { ...f.originalSession, expiresAt: new Date(Date.now() - 1000).toISOString() }, { ...f.originalSession, capabilities: { 'evm.signMessage': false } }]) {
    f.replaceSession(session);
    await assert.rejects(createAlchemySessionAccount({ loadResolver: async () => f.resolver, fetch: f.mockFetch, env: {} }), ProviderSigningError);
  }
  assert.equal(f.calls.length, 0);
});

test('non-provider payloads, wallet changes and unexpected transaction challenges are refused', async () => {
  const f = fixture({ invalidMethod: true });
  const account = await createAlchemySessionAccount({ loadResolver: async () => f.resolver, fetch: f.mockFetch, env: {} });
  await assert.rejects(account.signMessage({ message: 'ordinary arbitrary message' }), /仅签署/);
  assert.equal(f.calls.length, 0);
  await assert.rejects(account.signMessage({ message }), /不匹配/);
  assert.equal(f.calls.length, 1);
  f.replaceSession({ ...f.originalSession, evmAddress: privateKeyToAccount(generatePrivateKey()).address });
  await assert.rejects(account.signMessage({ message }), /钱包已改变/);
  assert.equal(f.calls.length, 1);
});

test('wrong returned signer is never sent on to the Router', async () => {
  const f = fixture({ wrongSigner: true });
  const account = await createAlchemySessionAccount({ loadResolver: async () => f.resolver, fetch: f.mockFetch, env: {} });
  await assert.rejects(account.signMessage({ message }), /签名与当前卖家地址不匹配/);
});

test('session credential destinations are restricted to the official HTTPS wallet API', () => {
  assert.equal(alchemyWalletApiBase({}), 'https://admin-api.alchemy.com');
  assert.throws(() => alchemyWalletApiBase({ ALCHEMY_BASE_DOMAIN: 'untrusted.invalid' }), ProviderSigningError);
  assert.throws(() => alchemyWalletApiBase({ ALCHEMY_WALLET_API_BASE_URL: 'http://127.0.0.1:9000' }), ProviderSigningError);
  assert.throws(() => alchemyWalletApiBase({ ALCHEMY_WALLET_API_BASE_URL: 'https://admin-api.alchemy.com.evil.invalid' }), ProviderSigningError);
});

test('account construction requires one explicit identity source', async () => {
  await assert.rejects(createProviderAccount(parseConfig([], {}), {}), /请选择一种/);
  const account = await createProviderAccount(parseConfig(['--ephemeral-wallet'], {}), {});
  assert.match(account.address, /^0x[0-9a-f]{40}$/i);
  await assert.rejects(createProviderAccount(parseConfig(['--ephemeral-wallet'], {}), { PROVIDER_PRIVATE_KEY: 'set-in-local-env' }), /不能同时设置/);
});

const buyerMessage = (wallet: string, nonce = 'a'.repeat(48), expiresAt = Date.now() + 60_000) => `InferPool buyer authentication\nDomain: 127.0.0.1:8788\nWallet: ${wallet.toLowerCase()}\nNonce: ${nonce}\nExpires: ${expiresAt}\nThis signature authenticates this session only. It does not authorize token transfers.`;

test('buyer factory signs the exact Router challenge, uses official delegated proof and refuses nonce reuse', async () => {
  const f = fixture();
  const account = await createAlchemyBuyerSessionAccount({ routerUrl: 'http://127.0.0.1:8788', loadResolver: async () => f.resolver, fetch: f.mockFetch, env: {} });
  const text = buyerMessage(account.address);
  assert.match(await account.signMessage({ message: text }), /^0x[0-9a-f]{130}$/i);
  assert.deepEqual(f.calls.map(call => new URL(call.url).pathname), ['/wallet/evm/sign-message/challenge', '/wallet/evm/sign-message/complete']);
  await assert.rejects(account.signMessage({ message: text }), /重放/);
  assert.equal(f.calls.length, 2);
});

test('buyer boundary rejects provider, cross-domain/wallet, expired, long-lived, appended or raw payloads before networking', async () => {
  const f = fixture();
  const account = await createAlchemyBuyerSessionAccount({ routerUrl: 'http://127.0.0.1:8788', loadResolver: async () => f.resolver, fetch: f.mockFetch, env: {} });
  const valid = buyerMessage(account.address);
  for (const invalid of [message, valid.replace('127.0.0.1:8788', 'evil.invalid'), valid.replace(account.address.toLowerCase(), '0x' + '1'.repeat(40)), buyerMessage(account.address, 'a'.repeat(48), Date.now() - 1), buyerMessage(account.address, 'a'.repeat(48), Date.now() + 600_000), valid + '\nTransfer funds', valid.replace('a'.repeat(48), 'short'), { raw: '0x1234' }]) {
    await assert.rejects(account.signMessage({ message: invalid as any }), ProviderSigningError);
  }
  assert.equal(f.calls.length, 0);
  const provider = await createAlchemySessionAccount({ loadResolver: async () => f.resolver, fetch: f.mockFetch, env: {} });
  await assert.rejects(provider.signMessage({ message: valid }), /仅签署/);
  assert.equal(f.calls.length, 0);
});

test('buyer factory rejects insecure remote origins and never permits credential-bearing Router URLs', async () => {
  for (const routerUrl of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com?key=x']) {
    await assert.rejects(createAlchemyBuyerSessionAccount({ routerUrl, loadResolver: async () => { throw new Error('must not read session'); }, env: {} }), ProviderSigningError);
  }
});
