import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { getAddress, type Hex } from 'viem';
import { createAlchemyBuyerSessionAccount } from '../provider/src/signer.js';
import { opaqueId } from '../server/src/evm-chain.js';
import { decimal, fee, units } from './legacy-money.js';
import { expectedSigner, model, monadContext, readJson, receiptEvidence, saveJson } from './setup-monad.js';

type Json = Record<string, any>;
const evidencePath = new URL('../contracts/deployments/inferpool-smoke-api-monad.json', import.meta.url);
const idempotencyKey = 'inferpool-monad-api-smoke-v1';
const keyName = 'InferPool Monad API smoke (temporary)';

function localOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('This smoke script only targets an explicitly configured local Router and Provider');
  return url.origin;
}

async function main() {
  const router = localOrigin(process.env.SMOKE_ROUTER_URL ?? 'http://127.0.0.1:8788');
  const providerUrl = localOrigin(process.env.SMOKE_PROVIDER_URL ?? 'http://127.0.0.1:8793');
  const ctx = await monadContext();
  const api = async (path: string, options: { token?: string; method?: string; body?: unknown; idempotency?: string; expectedStatus?: number } = {}): Promise<Json> => {
    const method = options.method ?? 'GET';
    const response = await fetch(router + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(150_000),
      headers: {
        Accept: 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.idempotency ? { 'Idempotency-Key': options.idempotency } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    if (response.status !== (options.expectedStatus ?? 200)) throw new Error(`Unexpected HTTP ${response.status} from ${method} ${path}; response body is not logged`);
    if (response.status === 204) return {};
    return await response.json() as Json;
  };
  const providerState = async (): Promise<Json> => {
    const response = await fetch(providerUrl + '/api/state', { redirect: 'error', signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error('The independently running Provider state endpoint is unavailable');
    return await response.json() as Json;
  };
  const config = await api('/config');
  assert.equal(config.chain_mode, 'monad-testnet');
  assert.equal(config.chain_id, 10143);
  assert.equal(getAddress(config.market_address), ctx.market);
  assert.equal(getAddress(config.token_address), ctx.token);
  const provider = await providerState();
  assert.equal(provider.status, 'online');
  assert.equal(provider.mode, 'normal');
  assert.equal(provider.mock, true);
  assert.equal(provider.walletMode, 'alchemy-session');
  assert.equal(getAddress(provider.wallet), expectedSigner);
  assert.equal(provider.modelId, model);
  assert.equal(new URL(provider.router).host, new URL(router).host);
  const models = await api('/v1/models');
  assert.ok(models.data.some((entry: Json) => entry.provider_id === provider.providerId && entry.online && entry.mode === 'normal' && getAddress(entry.seller) === expectedSigner));

  const body = { model, provider_id: provider.providerId, messages: [{ role: 'user', content: 'API smoke: Monad testnet.' }], max_tokens: 256, max_spend: '0.1', stream: false, cache: false };
  const report: Json = existsSync(evidencePath) ? readJson(evidencePath) : {
    network: 'monad-testnet', chainId: 10143, token: ctx.token, market: ctx.market,
    buyer: expectedSigner, seller: expectedSigner, router: expectedSigner,
    providerId: provider.providerId, mockInference: true,
    scope: 'Real HTTP buyer authentication and API-key request through a separately running Provider, with actual Monad testnet reservation and settlement. Buyer, seller and router use the SAME existing session wallet; this is not a two-independent-wallet or browser UI acceptance test.',
    idempotencyKey, requestBody: body,
  };
  assert.equal(getAddress(report.market), ctx.market);
  assert.equal(getAddress(report.buyer), expectedSigner);
  assert.equal(report.idempotencyKey, idempotencyKey);
  assert.deepEqual(report.requestBody, body);
  const checkpoint = () => { report.updatedAt = new Date().toISOString(); saveJson(evidencePath, report); };
  checkpoint();

  // Session/API-key values are process-local. Neither values nor their previews/hashes enter evidence.
  const wallet = await createAlchemyBuyerSessionAccount({ routerUrl: router });
  assert.equal(wallet.address, expectedSigner);
  const challenge = await api('/auth/challenge', { method: 'POST', body: { wallet: wallet.address } });
  const signature = await wallet.signMessage({ message: challenge.message });
  const session = await api('/auth/verify', { method: 'POST', body: { wallet: wallet.address, nonce: challenge.nonce, signature } });
  assert.equal(getAddress(session.wallet), expectedSigner);
  assert.ok(typeof session.token === 'string' && session.token.startsWith('ips_'));
  const sessionToken: string = session.token;
  report.authentication = { challengeEndpoint: '/auth/challenge', verificationEndpoint: '/auth/verify', buyerChallengeValidated: true, signatureVerifiedByRouter: true, wallet: wallet.address, verifiedAt: new Date().toISOString() };
  const keys = await api('/api-keys', { token: sessionToken });
  // An interrupted earlier attempt may have left this specifically named temporary key active.
  for (const old of keys.data) if (old.name === keyName && !old.revokedAt) await api(`/api-keys/${old.id}`, { token: sessionToken, method: 'DELETE', expectedStatus: 204 });
  let keyId: string | undefined;
  let keyToken: string | undefined;
  try {
    const created = await api('/api-keys', { token: sessionToken, method: 'POST', body: { name: keyName, expires_in_days: 1 }, expectedStatus: 201 });
    keyId = created.id;
    keyToken = created.token;
    assert.ok(typeof keyId === 'string' && /^[a-f0-9]{64}$/.test(keyId));
    assert.ok(typeof keyToken === 'string' && keyToken.startsWith('ipk_'));
    report.temporaryApiKey = { created: true, revoked: false, expiresAt: created.expiresAt };
    checkpoint();
    // Refuse to create replacement paid work if public evidence survives but Router state was removed.
    if (report.requestId) await api(`/v1/requests/${report.requestId}`, { token: keyToken });
    const accountBefore = await api('/account', { token: keyToken });
    assert.equal(accountBefore.credential_type, 'api-key');
    assert.equal(accountBefore.chain_mode, 'monad-testnet');
    const completion = await api('/v1/chat/completions', { token: keyToken, method: 'POST', body, idempotency: idempotencyKey });
    assert.equal(completion.object, 'chat.completion');
    assert.ok(typeof completion.id === 'string');
    if (report.requestId) assert.equal(completion.id, report.requestId);
    report.requestId = completion.id;
    report.onchainRequestId = opaqueId(completion.id);
    checkpoint();
    let bill = await api(`/v1/requests/${completion.id}`, { token: keyToken });
    const until = Date.now() + 150_000;
    while (!bill.billConfirmed && Date.now() < until) {
      await delay(1500);
      bill = await api(`/v1/requests/${completion.id}`, { token: keyToken });
    }
    assert.equal(bill.billConfirmed, true);
    assert.equal(bill.status, 'completed');
    assert.equal(bill.settlement, 'confirmed');
    assert.equal(bill.outcome, 0);
    assert.equal(bill.mock, true);
    assert.equal(bill.budget, '0.100000');
    assert.equal(bill.providerId, provider.providerId);
    assert.equal(getAddress(bill.buyer), expectedSigner);
    assert.equal(getAddress(bill.seller), expectedSigner);
    assert.equal(bill.usage.input, Array.from(JSON.stringify(body.messages)).length);
    assert.equal(bill.usage.output, Array.from(bill.output as string).length);
    assert.equal(bill.usage.cacheRead + bill.usage.cacheWrite, 0);
    assert.ok(bill.usage.output > 0 && bill.usage.output < body.max_tokens);
    assert.equal(units(bill.charge), fee(bill.quote, bill.usage));
    assert.equal(units(bill.released), units('0.1') - units(bill.charge));
    assert.match(bill.lockTx, /^0x[a-f0-9]{64}$/i);
    assert.match(bill.settlementTx, /^0x[a-f0-9]{64}$/i);
    const [reserve, settle] = await Promise.all([receiptEvidence(ctx, bill.lockTx as Hex), receiptEvidence(ctx, bill.settlementTx as Hex)]);
    assert.equal(getAddress(reserve.to!), ctx.market);
    assert.equal(getAddress(settle.to!), ctx.market);
    assert.ok(BigInt(reserve.blockNumber) < BigInt(settle.blockNumber));
    const chainOrder = await ctx.client.readContract({ address: ctx.market, abi: ctx.marketAbi, functionName: 'getOrder', args: [opaqueId(completion.id)] }) as Json;
    assert.equal(Number(chainOrder.state), 2);
    assert.equal(Number(chainOrder.outcome), 0);
    assert.equal(chainOrder.charged, units(bill.charge));
    assert.equal(chainOrder.reserved, units('0.1'));
    assert.equal(chainOrder.modelId, opaqueId(model));
    assert.equal(getAddress(chainOrder.buyer), expectedSigner);
    assert.equal(getAddress(chainOrder.provider), expectedSigner);
    for (const bucket of ['input', 'cacheRead', 'cacheWrite', 'output']) assert.equal(chainOrder.usage[bucket], BigInt(bill.usage[bucket]));
    const providerAfter = await providerState();
    const providerRun = providerAfter.requests.find((run: Json) => run.requestId === completion.id);
    // Provider history is deliberately process-local; preserve a previously verified run on later reruns.
    if (providerRun) {
      assert.equal(providerRun.status, 'completed');
      assert.equal(providerRun.mode, 'normal');
      assert.deepEqual(providerRun.usage, bill.usage);
      report.providerExecution = { observedAt: new Date().toISOString(), providerId: providerAfter.providerId, model: providerAfter.modelId, wallet: providerAfter.wallet, walletMode: providerAfter.walletMode, run: providerRun };
    } else assert.equal(report.providerExecution?.run?.requestId, completion.id, 'Independent Provider must have observed this request');
    const replay = await api('/v1/chat/completions', { token: keyToken, method: 'POST', body, idempotency: idempotencyKey });
    assert.equal(replay.id, completion.id);
    assert.equal(replay.request.lockTx, bill.lockTx);
    assert.equal(replay.request.settlementTx, bill.settlementTx);
    assert.equal(replay.request.charge, bill.charge);
    const accountAfter = await api('/account', { token: keyToken });
    assert.equal(accountAfter.available, accountBefore.available, 'With the same buyer/seller wallet, seller revenue returns to the same escrow account');
    report.bill = { requestId: bill.id, providerId: bill.providerId, status: bill.status, settlement: bill.settlement, billConfirmed: bill.billConfirmed, budget: bill.budget, charge: bill.charge, released: bill.released, usage: bill.usage, quote: bill.quote, cacheMode: bill.cacheMode, mock: bill.mock, output: bill.output, createdAt: bill.createdAt, updatedAt: bill.updatedAt };
    report.receipts = { reserve, settle };
    report.onchainOrder = chainOrder;
    report.accountAfter = accountAfter;
    report.idempotencyVerified = { sameRequestId: true, sameReservationTransaction: true, sameSettlementTransaction: true, noSecondInferenceCharge: true };
    report.sameWalletBalanceExplanation = 'Fees consume buyer spending authorization but are credited back as seller earnings to the same escrow account. This does not demonstrate independent buyer/seller ownership.';
    report.verifiedAt = new Date().toISOString();
    checkpoint();
  } finally {
    if (keyId) {
      await api(`/api-keys/${keyId}`, { token: sessionToken, method: 'DELETE', expectedStatus: 204 });
      const remaining = await api('/api-keys', { token: sessionToken });
      assert.ok(remaining.data.some((key: Json) => key.id === keyId && key.revokedAt));
      if (keyToken) await api('/v1/requests', { token: keyToken, expectedStatus: 401 });
      report.temporaryApiKey = { ...report.temporaryApiKey, revoked: true, rejectedAfterRevocation: true, revokedAt: new Date().toISOString() };
      checkpoint();
    }
    keyToken = undefined;
  }
  console.log(JSON.stringify({ smoke: 'passed', evidence: fileURLToPath(evidencePath), requestId: report.requestId, charge: report.bill.charge, released: report.bill.released, reserveTx: report.receipts.reserve.transactionHash, settleTx: report.receipts.settle.transactionHash, temporaryApiKeyRevoked: report.temporaryApiKey.revoked, gasCostMON: decimal((BigInt(report.receipts.reserve.monadGasLimitCostWei) + BigInt(report.receipts.settle.monadGasLimitCostWei)) / 1_000_000_000_000n) }));
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'Monad API smoke failed'); process.exitCode = 1; });
