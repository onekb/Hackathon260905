import assert from 'node:assert/strict';
import { closeSync, existsSync, mkdirSync, openSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decodeFunctionData, getAddress, type Hex } from 'viem';
import { createAlchemyBuyerSessionAccount } from '../provider/src/signer.js';
import { opaqueId } from '../server/src/evm-chain.js';
import { decimal, emptyUsage, fee, mockTokens, units, type Quote } from './legacy-money.js';
import { expectedSigner, model, monadContext, readJson, receiptEvidence, type MonadContext } from './setup-monad.js';

type Json = Record<string, any>;
const sellerB = getAddress('0xbc81a46f5eee3924aa0b7fd8849ea08351194a75');
const evidencePath = new URL('../contracts/deployments/inferpool-smoke-market-monad.json', import.meta.url);
const lockPath = new URL('../.local/smoke-market-monad.lock', import.meta.url);
const keyName = 'InferPool Monad two-seller smoke (temporary)';
const buckets = ['input', 'cacheRead', 'cacheWrite', 'output'] as const;
const sellers = {
  a: { id: 'seller-monad', wallet: expectedSigner, walletMode: 'alchemy-session', quote: { input: '30', cacheRead: '3', cacheWrite: '37.5', output: '80', minReserve: '0.0001' } },
  b: { id: 'seller-para', wallet: sellerB, walletMode: 'browser-wallet', quote: { input: '60', cacheRead: '6', cacheWrite: '75', output: '40', minReserve: '0.0001' } },
} satisfies Record<string, { id: string; wallet: string; walletMode: string; quote: Quote }>;
type Seller = keyof typeof sellers;
const definitions: { name: string; content: string; maxTokens: number; selected: Seller; explicit: boolean; outcome: number }[] = [
  { name: 'explicit_b', content: 'Market smoke: explicitly choose seller B.', maxTokens: 512, selected: 'b', explicit: true, outcome: 0 },
  { name: 'auto_short_b', content: 'Market smoke: short input.', maxTokens: 512, selected: 'b', explicit: false, outcome: 0 },
  { name: 'auto_long_a', content: 'Long input routing probe. '.repeat(20), maxTokens: 16, selected: 'a', explicit: false, outcome: 2 },
];

export function marketPlan() {
  return definitions.map(item => {
    const messages = [{ role: 'user', content: item.content }];
    const input = mockTokens(JSON.stringify(messages));
    const estimates = Object.entries(sellers).map(([key, seller]) => {
      const largestInputPrice = [seller.quote.input, seller.quote.cacheRead, seller.quote.cacheWrite].reduce((a, b) => units(a) > units(b) ? a : b);
      const admission = fee({ ...seller.quote, input: largestInputPrice }, { ...emptyUsage(), input });
      assert.ok(admission <= units('0.1'), 'Both sellers must qualify; a routing win must not be caused by excluding the other seller');
      return { seller: key, providerId: seller.id, quote: seller.quote, inputAdmissionDemoUSD: decimal(admission), estimatedDemoUSD: decimal(fee(seller.quote, { ...emptyUsage(), input, output: item.maxTokens })) };
    }).sort((a, b) => units(a.estimatedDemoUSD) < units(b.estimatedDemoUSD) ? -1 : units(a.estimatedDemoUSD) > units(b.estimatedDemoUSD) ? 1 : a.providerId.localeCompare(b.providerId));
    if (!item.explicit) assert.equal(estimates[0]!.seller, item.selected);
    return {
      name: item.name, idempotencyKey: `inferpool-monad-market-v1-${item.name}`,
      body: { model, ...(item.explicit ? { provider_id: sellers[item.selected].id } : {}), messages, max_tokens: item.maxTokens, max_spend: '0.1', stream: true, cache: false },
      inputUnits: input, expectedProviderId: sellers[item.selected].id, expectedSeller: sellers[item.selected].wallet,
      expectedOutcome: item.outcome, expectedStatus: item.outcome === 2 ? 'budget_capped' : 'completed',
      expectedSelection: item.explicit ? 'Buyer explicitly names seller B' : 'Lowest estimated input plus maximum-output fee among both eligible sellers',
      estimates, sameBuyerAndSellerWallet: item.selected === 'a',
      ...(item.outcome === 2 ? { limitExplanation: 'This case reaches max_tokens=16. The Router uses BudgetCapped for either the output-token cap or spending cap; this case does not exhaust the 0.1 dUSD budget.' } : {}),
    };
  });
}

function localOrigin(value: string) {
  const url = new URL(value);
  assert.ok(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'Only local Router/Provider endpoints are allowed');
  return url.origin;
}

async function snapshot(ctx: MonadContext, blockNumber: bigint, grantId?: bigint) {
  const read = (functionName: string, args: readonly unknown[]) => ctx.client.readContract({ address: ctx.market, abi: ctx.marketAbi, functionName, args, blockNumber });
  const id = grantId ?? await read('activeGrantId', [expectedSigner]) as bigint;
  const [a, b, grant] = await Promise.all([read('balances', [expectedSigner]), read('balances', [sellerB]), read('getGrant', [expectedSigner, id])]);
  return { blockNumber, aEscrowBaseUnits: a as bigint, bEscrowBaseUnits: b as bigint, aEscrowDemoUSD: decimal(a as bigint), bEscrowDemoUSD: decimal(b as bigint), grantId: id, grant: grant as Json };
}

function assertQuote(actual: Json, expected: Quote) {
  assert.equal(actual.active, true);
  assert.equal(BigInt(actual.minReserve), units(expected.minReserve));
  assert.ok(BigInt(actual.version) > 0n);
  for (const bucket of buckets) assert.equal(BigInt(actual.prices[bucket]), units(expected[bucket]));
}

function loadReport(ctx: MonadContext): Json {
  const plan = marketPlan();
  const report: Json = existsSync(evidencePath) ? readJson(evidencePath) : {
    schemaVersion: 1, network: 'monad-testnet', chainId: 10143, market: ctx.market, token: ctx.token,
    buyer: expectedSigner, routerWallet: expectedSigner, sellers, plan, cases: {},
    scope: 'Three real authenticated HTTP API requests routed through two independently running mock Providers, using two different seller wallets and live Monad testnet quotes. Explicit-B and auto-short-B transfer fees from A to B. Auto-long-A is a SAME-wallet buyer/seller case; it proves selection and accounting, not independent buyer/seller ownership.',
    metering: 'Unicode code points in serialized messages and output are simulated token units; no real model or real tokenizer is attested.',
    matchingFormula: 'ceil((inputPriceMicroUSD * mockInputUnits + outputPriceMicroUSD * max_tokens) / 1000000), using chain quotes; cache is disabled and both providers must be in normal mode.',
  };
  assert.equal(getAddress(report.market), ctx.market);
  assert.equal(getAddress(report.buyer), expectedSigner);
  assert.deepEqual(report.plan, plan, 'Do not mutate an existing public plan or replace its idempotency keys to force new paid work');
  return report;
}

function checkpoint(report: Json) {
  report.updatedAt = new Date().toISOString();
  const temp = new URL(evidencePath.href + '.tmp');
  writeFileSync(temp, JSON.stringify(report, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2) + '\n');
  renameSync(temp, evidencePath);
}

function printSummary(report: Json) {
  console.log(JSON.stringify({ smoke: 'passed', evidence: fileURLToPath(evidencePath), aggregate: report.aggregate, temporaryApiKeyRevoked: report.temporaryApiKey.revoked }, (_key, value) => typeof value === 'bigint' ? value.toString() : value));
}

// This command reads public RPC state only. It does not load a wallet session or submit anything.
async function verifyQuoteB(hash: Hex) {
  const ctx = await monadContext();
  const [receipt, transaction] = await Promise.all([ctx.client.getTransactionReceipt({ hash }), ctx.client.getTransaction({ hash })]);
  assert.equal(receipt.status, 'success');
  assert.equal(getAddress(receipt.from), sellerB);
  assert.equal(getAddress(receipt.to!), ctx.market);
  assert.equal(transaction.value, 0n);
  const decoded = decodeFunctionData({ abi: ctx.marketAbi, data: transaction.input });
  assert.equal(decoded.functionName, 'upsertQuote');
  const args = decoded.args as readonly any[];
  assert.equal(args[0], opaqueId(model));
  for (const bucket of buckets) assert.equal(args[1][bucket], units(sellers.b.quote[bucket]));
  assert.equal(args[2], units('0.0001'));
  assert.equal(args[3], true);
  const readQuote = (blockNumber?: bigint) => ctx.client.readContract({ address: ctx.market, abi: ctx.marketAbi, functionName: 'getQuote', args: [sellerB, opaqueId(model)], ...(blockNumber === undefined ? {} : { blockNumber }) });
  const [before, confirmed, current] = await Promise.all([readQuote(receipt.blockNumber - 1n), readQuote(receipt.blockNumber), readQuote()]) as Json[];
  assert.equal(before!.active, false);
  assert.equal(BigInt(before!.version), 0n);
  assertQuote(confirmed!, sellers.b.quote);
  assert.equal(BigInt(confirmed!.version), 1n);
  assertQuote(current!, sellers.b.quote);
  const report = loadReport(ctx);
  report.quoteBPublication = {
    transactionHash: hash, receiptStatus: receipt.status, from: getAddress(receipt.from), to: getAddress(receipt.to!),
    blockNumber: receipt.blockNumber, functionName: decoded.functionName, args, valueWei: transaction.value,
    gasLimit: transaction.gas, gasUsed: receipt.gasUsed, effectiveGasPrice: receipt.effectiveGasPrice,
    monadGasLimitCostWei: transaction.gas * receipt.effectiveGasPrice, quoteBefore: before, quoteAtPublication: confirmed, currentQuote: current,
    explorerUrl: `https://testnet.monadscan.com/tx/${hash}`, checkedThroughReadOnlyRpc: true, verifiedAt: new Date().toISOString(),
  };
  if (!report.verifiedAt) report.status = 'quote_b_verified_market_requests_pending';
  checkpoint(report);
  console.log(JSON.stringify({ quoteBVerified: true, transactionHash: hash, seller: sellerB, version: String(confirmed!.version), requestsExecuted: false, evidence: fileURLToPath(evidencePath) }));
}

export function validateFailedRetryEvidence(proof: { bill: Json; order: Json; blockTimestamp: bigint; pendingNonce: number; latestNonce: number; nowSeconds: number }) {
  const { bill, order } = proof;
  assert.equal(bill.status, 'lock_failed', 'Retry requires the Router to have finalized the original reservation failure');
  assert.equal(bill.settlement, 'unsubmitted');
  assert.ok(Number.isSafeInteger(bill.deadline) && bill.deadline > 0);
  assert.ok(proof.nowSeconds > bill.deadline && proof.blockTimestamp > BigInt(bill.deadline), 'Both wall time and the observed chain block must be beyond the original deadline');
  assert.equal(Number(order.state), 0, 'The original order must remain absent on chain after its deadline');
  assert.equal(BigInt(order.reserved), 0n);
  assert.equal(BigInt(order.charged), 0n);
  for (const bucket of buckets) assert.equal(bill.usage[bucket], 0, 'No mock inference may have run for the failed reservation');
  assert.equal(bill.output, '');
  assert.equal(units(bill.charge), 0n);
  assert.ok(!bill.lockTx && !bill.settlementTx, 'An order with any transaction reference requires separate reconciliation, not this retry path');
  assert.equal(proof.pendingNonce, proof.latestNonce, 'Do not retry while the Router wallet has a pending transaction');
}

async function execute(recoveries: Map<string, string>, retryLockFailed: boolean) {
  const router = localOrigin(process.env.SMOKE_ROUTER_URL ?? 'http://127.0.0.1:8788');
  const providerUrls = {
    a: localOrigin(process.env.SMOKE_PROVIDER_A_URL ?? 'http://127.0.0.1:8793'),
    b: localOrigin(process.env.SMOKE_PROVIDER_B_URL ?? 'http://127.0.0.1:8794'),
  };
  assert.notEqual(providerUrls.a, providerUrls.b, 'Two distinct Provider processes/endpoints are required');
  const ctx = await monadContext();
  const plan = marketPlan();
  const report = loadReport(ctx);
  const save = () => checkpoint(report);
  const api = async (path: string, options: { token?: string; method?: string; body?: unknown; idempotency?: string; expectedStatus?: number } = {}): Promise<Json> => {
    const method = options.method ?? 'GET';
    const response = await fetch(router + path, { method, redirect: 'error', signal: AbortSignal.timeout(150_000), headers: {
      Accept: 'application/json', ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.idempotency ? { 'Idempotency-Key': options.idempotency } : {}),
    }, ...(options.body ? { body: JSON.stringify(options.body) } : {}) });
    assert.equal(response.status, options.expectedStatus ?? 200, `Unexpected HTTP status for ${method} ${path}; response body is deliberately not logged`);
    return response.status === 204 ? {} : await response.json() as Json;
  };
  const providerState = async (key: Seller): Promise<Json> => {
    const response = await fetch(providerUrls[key] + '/api/state', { redirect: 'error', signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 200, `Provider ${key} state endpoint unavailable`);
    return await response.json() as Json;
  };
  const readiness = async () => {
    const block = await ctx.client.getBlock();
    const [states, listed, quotes] = await Promise.all([
      Promise.all((['a', 'b'] as const).map(providerState)), api('/v1/models'),
      Promise.all((['a', 'b'] as const).map(key => ctx.client.readContract({ address: ctx.market, abi: ctx.marketAbi, functionName: 'getQuote', args: [sellers[key].wallet, opaqueId(model)], blockNumber: block.number }))),
    ]);
    const evidence: Json = { observedAt: new Date().toISOString(), blockNumber: block.number, processes: {}, chainQuotes: {} };
    for (const [index, key] of (['a', 'b'] as const).entries()) {
      const state = states[index]!;
      assert.equal(state.providerId, sellers[key].id);
      assert.equal(getAddress(state.wallet), sellers[key].wallet);
      assert.equal(state.walletMode, sellers[key].walletMode);
      assert.equal(state.status, 'online');
      assert.equal(state.mode, 'normal');
      assert.equal(state.mock, true);
      assert.equal(state.modelId, model);
      assert.equal(new URL(state.router).host, new URL(router).host);
      assert.equal(state.active, 0, 'Keep other inference requests idle during this bounded accounting test');
      assert.ok(state.availableSlots > 0);
      const entry = listed.data.find((candidate: Json) => candidate.provider_id === sellers[key].id);
      assert.ok(entry?.online && entry.available_slots > 0 && entry.mode === 'normal');
      assert.equal(getAddress(entry.seller), sellers[key].wallet);
      assertQuote(quotes[index] as Json, sellers[key].quote);
      evidence.processes[key] = { stateEndpoint: providerUrls[key] + '/api/state', providerId: state.providerId, wallet: getAddress(state.wallet), walletMode: state.walletMode, modelId: state.modelId, status: state.status, mode: state.mode, availableSlots: state.availableSlots, mock: state.mock };
      evidence.chainQuotes[key] = quotes[index];
    }
    assert.equal(listed.data.filter((entry: Json) => entry.id === model && entry.online).length, 2, 'A third live seller would make this two-seller matching expectation ambiguous');
    assert.notEqual(evidence.processes.a.wallet, evidence.processes.b.wallet);
    return evidence;
  };
  const config = await api('/config');
  assert.equal(config.chain_mode, 'monad-testnet');
  assert.equal(config.chain_id, 10143);
  assert.equal(getAddress(config.market_address), ctx.market);
  assert.equal(getAddress(config.token_address), ctx.token);
  report.latestReadiness = await readiness();
  save();

  // The signer only accepts the exact Router buyer-authentication challenge. Values remain in memory.
  const wallet = await createAlchemyBuyerSessionAccount({ routerUrl: router });
  assert.equal(wallet.address, expectedSigner);
  const challenge = await api('/auth/challenge', { method: 'POST', body: { wallet: wallet.address } });
  const signature = await wallet.signMessage({ message: challenge.message });
  const session = await api('/auth/verify', { method: 'POST', body: { wallet: wallet.address, nonce: challenge.nonce, signature } });
  assert.equal(getAddress(session.wallet), expectedSigner);
  assert.ok(typeof session.token === 'string' && session.token.startsWith('ips_'));
  const sessionToken: string = session.token;
  report.authentication = { buyer: wallet.address, challengeEndpoint: '/auth/challenge', verificationEndpoint: '/auth/verify', signatureVerifiedByRouter: true, verifiedAt: new Date().toISOString() };
  const keys = await api('/api-keys', { token: sessionToken });
  for (const old of keys.data) if (old.name === keyName && !old.revokedAt) await api(`/api-keys/${old.id}`, { token: sessionToken, method: 'DELETE', expectedStatus: 204 });
  let keyId: string | undefined;
  let keyToken: string | undefined;
  try {
    const key = await api('/api-keys', { token: sessionToken, method: 'POST', body: { name: keyName, expires_in_days: 1 }, expectedStatus: 201 });
    keyId = key.id;
    keyToken = key.token;
    assert.ok(typeof keyId === 'string' && /^[a-f0-9]{64}$/.test(keyId));
    assert.ok(typeof keyToken === 'string' && keyToken.startsWith('ipk_'));
    report.temporaryApiKey = { created: true, revoked: false, expiresAt: key.expiresAt };
    save();
    for (const item of plan) {
      let saved: Json = report.cases[item.name] ??= { name: item.name, idempotencyKey: item.idempotencyKey, requestBody: item.body };
      const retryKey = `${item.idempotencyKey}-retry-1`;
      if (retryLockFailed && item.name === 'auto_long_a' && !saved.retryOfRequestId) {
        assert.equal(saved.idempotencyKey, item.idempotencyKey);
        assert.ok(saved.requestId, 'Only a known original request can enter the explicit failed-lock retry path');
        assert.ok(!(report.failedAttempts ?? []).some((attempt: Json) => attempt.caseName === item.name), 'Only one explicit retry is allowed for this case');
        const bill = await api(`/v1/requests/${saved.requestId}`, { token: keyToken });
        assert.equal(bill.id, saved.requestId);
        assert.equal(getAddress(bill.buyer), expectedSigner);
        assert.equal(getAddress(bill.seller), item.expectedSeller);
        assert.equal(bill.providerId, item.expectedProviderId);
        assert.equal(bill.model, model);
        assert.equal(bill.budget, '0.100000');
        const block = await ctx.client.getBlock();
        const [order, pendingNonce, latestNonce] = await Promise.all([
          ctx.client.readContract({ address: ctx.market, abi: ctx.marketAbi, functionName: 'getOrder', args: [opaqueId(saved.requestId)], blockNumber: block.number }),
          ctx.client.getTransactionCount({ address: expectedSigner, blockTag: 'pending' }),
          ctx.client.getTransactionCount({ address: expectedSigner, blockTag: 'latest' }),
        ]);
        const proof = { bill, order: order as Json, blockTimestamp: block.timestamp, pendingNonce, latestNonce, nowSeconds: Math.floor(Date.now() / 1000) };
        validateFailedRetryEvidence(proof);
        report.failedAttempts ??= [];
        report.failedAttempts.push({ caseName: item.name, originalPlanIdempotencyKey: item.idempotencyKey, attempt: saved, finalRouterBill: bill, proof: { blockNumber: block.number, ...proof }, retryIdempotencyKey: retryKey, chargedDemoUSD: '0.000000', noInferenceDispatched: true, originalDeadlineExpired: true, recordedAt: new Date().toISOString() });
        saved = report.cases[item.name] = { name: item.name, idempotencyKey: retryKey, requestBody: item.body, originalPlanIdempotencyKey: item.idempotencyKey, retryOfRequestId: saved.requestId, retryNumber: 1, retryEnabledByExplicitFlag: '--retry-lock-failed auto_long_a' };
        // Archive the original attempt and fixed replacement key together before any new submission.
        // An interrupted retry resumes this same record; no second derived key is ever generated.
        save();
      }
      if (saved.retryOfRequestId) {
        assert.equal(item.name, 'auto_long_a');
        assert.equal(saved.retryNumber, 1);
        assert.equal(saved.idempotencyKey, retryKey);
        assert.equal(saved.originalPlanIdempotencyKey, item.idempotencyKey);
        assert.equal((report.failedAttempts ?? []).filter((attempt: Json) => attempt.attempt.requestId === saved.retryOfRequestId && attempt.retryIdempotencyKey === retryKey).length, 1);
      } else assert.equal(saved.idempotencyKey, item.idempotencyKey);
      assert.deepEqual(saved.requestBody, item.body);
      if (recoveries.has(item.name)) {
        const supplied = recoveries.get(item.name)!;
        assert.ok(saved.submissionStartedAt, 'Manual recovery only attaches a known request to a previously checkpointed submission intent');
        if (saved.requestId) assert.equal(saved.requestId, supplied);
        saved.requestId = supplied;
        saved.manuallyRecoveredKnownRequestId = true;
        save();
      }
      if (!saved.requestId) {
        assert.ok(!saved.submissionStartedAt, `The ${item.name} submission outcome is unknown. Inspect Router state and use --recover ${item.name}=KNOWN_REQUEST_ID; this script will not resubmit or invent a new idempotency key`);
        saved.readinessBeforeSubmission = await readiness();
        const account = await api('/account', { token: keyToken });
        assert.equal(account.credential_type, 'api-key');
        assert.ok(units(account.available) >= units('0.1') && units(account.authorized) >= units('0.1'), 'Existing escrow and authorization must cover this case; the script never deposits or replaces a grant');
        saved.submissionStartedAt = new Date().toISOString();
        saved.submissionState = 'intent_saved';
        save();
        // Stream headers expose the durable request ID immediately after reservation. Save it before
        // reading output. Closing this SSE transport does not cancel inference; poll this exact ID.
        const response: Response = await fetch(router + '/v1/chat/completions', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(150_000), headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json', Authorization: `Bearer ${keyToken}`, 'Idempotency-Key': saved.idempotencyKey }, body: JSON.stringify(item.body) });
        assert.equal(response.status, 200, 'Inference submission failed; intent is retained and no automatic replacement is allowed');
        const id = response.headers.get('x-request-id');
        assert.ok(id && /^[a-f0-9-]{36}$/i.test(id), 'SSE must identify the durable request');
        saved.requestId = id;
        saved.submissionState = 'known_request';
        save();
        await response.body?.cancel();
      }
      let bill = await api(`/v1/requests/${saved.requestId}`, { token: keyToken });
      const until = Date.now() + 180_000;
      while (!bill.billConfirmed && Date.now() < until) {
        await delay(1500);
        bill = await api(`/v1/requests/${saved.requestId}`, { token: keyToken });
      }
      saved.lastObservedBill = { observedAt: new Date().toISOString(), requestId: bill.id, status: bill.status, settlement: bill.settlement, billConfirmed: bill.billConfirmed, providerId: bill.providerId, buyer: bill.buyer, seller: bill.seller, usage: bill.usage, lockTx: bill.lockTx, settlementTx: bill.settlementTx, deadline: bill.deadline };
      save();
      assert.equal(bill.billConfirmed, true, 'Known request is still unsettled; rerun queries the same ID and never submits a replacement');
      assert.equal(bill.status, item.expectedStatus);
      assert.equal(bill.outcome, item.expectedOutcome);
      assert.equal(bill.settlement, 'confirmed');
      assert.equal(bill.providerId, item.expectedProviderId);
      assert.equal(getAddress(bill.seller), item.expectedSeller);
      assert.equal(getAddress(bill.buyer), expectedSigner);
      assert.equal(bill.model, model);
      assert.equal(bill.mock, true);
      assert.equal(bill.cacheMode, 'none');
      assert.equal(bill.maxTokens, item.body.max_tokens);
      assert.equal(bill.budget, '0.100000');
      assert.equal(bill.usage.input, item.inputUnits);
      assert.equal(bill.usage.cacheRead + bill.usage.cacheWrite, 0);
      assert.equal(bill.usage.output, mockTokens(bill.output));
      assert.ok(bill.usage.output > 0 && bill.usage.output <= item.body.max_tokens);
      if (item.expectedOutcome === 2) assert.equal(bill.usage.output, item.body.max_tokens);
      const chosenKey: Seller = item.expectedSeller === expectedSigner ? 'a' : 'b';
      for (const bucket of buckets) assert.equal(units(bill.quote[bucket]), units(sellers[chosenKey].quote[bucket]));
      assert.equal(units(bill.charge), fee(bill.quote, bill.usage));
      assert.equal(units(bill.released), units('0.1') - units(bill.charge));
      assert.match(bill.lockTx, /^0x[a-f0-9]{64}$/i);
      assert.match(bill.settlementTx, /^0x[a-f0-9]{64}$/i);
      const [reserve, settle, reserveTransaction, settleTransaction, rawOrder] = await Promise.all([
        receiptEvidence(ctx, bill.lockTx as Hex), receiptEvidence(ctx, bill.settlementTx as Hex),
        ctx.client.getTransaction({ hash: bill.lockTx as Hex }), ctx.client.getTransaction({ hash: bill.settlementTx as Hex }),
        ctx.client.readContract({ address: ctx.market, abi: ctx.marketAbi, functionName: 'getOrder', args: [opaqueId(saved.requestId)] }),
      ]);
      const order = rawOrder as Json;
      assert.equal(getAddress(reserve.to!), ctx.market);
      assert.equal(getAddress(settle.to!), ctx.market);
      assert.equal(Number(order.state), 2);
      assert.equal(Number(order.outcome), item.expectedOutcome);
      assert.equal(getAddress(order.buyer), expectedSigner);
      assert.equal(getAddress(order.provider), item.expectedSeller);
      assert.equal(order.modelId, opaqueId(model));
      assert.equal(order.reserved, units('0.1'));
      assert.equal(order.charged, units(bill.charge));
      assert.equal(order.quoteVersion, BigInt(bill.quote.version));
      for (const bucket of buckets) {
        assert.equal(order.usage[bucket], BigInt(bill.usage[bucket]));
        assert.equal(order.prices[bucket], units(sellers[chosenKey].quote[bucket]));
      }
      const reserveCall = decodeFunctionData({ abi: ctx.marketAbi, data: reserveTransaction.input });
      const settleCall = decodeFunctionData({ abi: ctx.marketAbi, data: settleTransaction.input });
      assert.equal(reserveCall.functionName, 'reserve');
      assert.equal(settleCall.functionName, 'settle');
      const reserveArgs = reserveCall.args as readonly any[];
      const settleArgs = settleCall.args as readonly any[];
      assert.equal(reserveArgs[0], opaqueId(saved.requestId));
      assert.equal(getAddress(reserveArgs[1]), expectedSigner);
      assert.equal(getAddress(reserveArgs[2]), item.expectedSeller);
      assert.equal(reserveArgs[3], opaqueId(model));
      assert.equal(reserveArgs[4], units('0.1'));
      assert.equal(reserveArgs[6], order.quoteVersion);
      assert.equal(settleArgs[0], opaqueId(saved.requestId));
      assert.equal(Number(settleArgs[2]), item.expectedOutcome);
      for (const bucket of buckets) assert.equal(settleArgs[1][bucket], BigInt(bill.usage[bucket]));
      const reserveBlock = BigInt(reserve.blockNumber);
      const settleBlock = BigInt(settle.blockNumber);
      assert.ok(reserveBlock < settleBlock);
      const [beforeReserve, afterReserve, afterSettle] = await Promise.all([snapshot(ctx, reserveBlock - 1n, order.grantId), snapshot(ctx, reserveBlock, order.grantId), snapshot(ctx, settleBlock, order.grantId)]);
      assert.equal(afterReserve.aEscrowBaseUnits, beforeReserve.aEscrowBaseUnits - order.reserved);
      assert.equal(afterReserve.bEscrowBaseUnits, beforeReserve.bEscrowBaseUnits);
      assert.equal(afterReserve.grant.locked, beforeReserve.grant.locked + order.reserved);
      assert.equal(afterReserve.grant.spent, beforeReserve.grant.spent);
      const externalCharge = chosenKey === 'b' ? order.charged as bigint : 0n;
      assert.equal(afterSettle.aEscrowBaseUnits, beforeReserve.aEscrowBaseUnits - externalCharge);
      assert.equal(afterSettle.bEscrowBaseUnits, beforeReserve.bEscrowBaseUnits + externalCharge);
      assert.equal(afterSettle.grant.spent, beforeReserve.grant.spent + order.charged);
      assert.equal(afterSettle.grant.locked, 0n);
      assert.equal(beforeReserve.grant.locked, 0n);
      const state = await providerState(chosenKey);
      const run = state.requests.find((entry: Json) => entry.requestId === saved.requestId);
      if (run) {
        assert.equal(run.mode, 'normal');
        assert.ok(['completed', ...(item.expectedOutcome === 2 ? ['cancelled'] : [])].includes(run.status));
        assert.equal(run.outputTokens, bill.usage.output);
        assert.equal(run.usage.input, bill.usage.input);
        saved.providerExecution = { observedAt: new Date().toISOString(), providerId: state.providerId, wallet: getAddress(state.wallet), walletMode: state.walletMode, run };
      } else assert.equal(saved.providerExecution?.run?.requestId, saved.requestId, 'Independent Provider must have observed the request; a preserved earlier observation can survive process restart');
      // This is a deliberate replay of a known, settled request with the identical key/body. It
      // cannot turn an ambiguous first submission into replacement paid work.
      const replay = await api('/v1/chat/completions', { token: keyToken, method: 'POST', body: { ...item.body, stream: false }, idempotency: saved.idempotencyKey });
      assert.equal(replay.id, saved.requestId);
      assert.equal(replay.request.lockTx, bill.lockTx);
      assert.equal(replay.request.settlementTx, bill.settlementTx);
      assert.equal(replay.request.charge, bill.charge);
      Object.assign(saved, {
        submissionState: 'verified', onchainRequestId: opaqueId(saved.requestId), bill,
        receipts: { reserve: { ...reserve, functionName: reserveCall.functionName, args: reserveArgs }, settle: { ...settle, functionName: settleCall.functionName, args: settleArgs } },
        order, snapshots: { beforeReserve, afterReserve, afterSettle }, estimates: item.estimates,
        explicitSelection: Object.hasOwn(item.body, 'provider_id'), actualProviderMatchesExpected: true,
        sameBuyerAndSellerWallet: item.sameBuyerAndSellerWallet, crossWalletFeeTransferBaseUnits: externalCharge,
        idempotencyVerified: { sameRequestId: true, sameReservationTransaction: true, sameSettlementTransaction: true, noSecondInferenceCharge: true },
        verifiedAt: new Date().toISOString(),
      });
      save();
      console.log(JSON.stringify({ case: item.name, requestId: saved.requestId, provider: bill.providerId, status: bill.status, charge: bill.charge, reserveTx: bill.lockTx, settleTx: bill.settlementTx }));
    }
    const completed: Json[] = plan.map(item => report.cases[item.name]);
    const first = completed[0]!.snapshots.beforeReserve;
    const last = completed.at(-1)!.snapshots.afterSettle;
    const totalCharged = completed.reduce((sum, entry) => sum + BigInt(entry.order.charged), 0n);
    const crossWalletCharged = completed.reduce((sum, entry) => sum + BigInt(entry.crossWalletFeeTransferBaseUnits), 0n);
    assert.equal(BigInt(first.aEscrowBaseUnits) - BigInt(last.aEscrowBaseUnits), crossWalletCharged);
    assert.equal(BigInt(last.bEscrowBaseUnits) - BigInt(first.bEscrowBaseUnits), crossWalletCharged);
    assert.equal(BigInt(last.grant.spent) - BigInt(first.grant.spent), totalCharged);
    assert.equal(BigInt(last.grant.locked), 0n);
    report.aggregate = { count: completed.length, totalBuyerAuthorizationSpentDemoUSD: decimal(totalCharged), crossWalletAtoBDemoUSD: decimal(crossWalletCharged), selfTradeFeeCreditedBackToADemoUSD: decimal(totalCharged - crossWalletCharged), aEscrowBeforeDemoUSD: first.aEscrowDemoUSD, aEscrowAfterDemoUSD: last.aEscrowDemoUSD, bEscrowBeforeDemoUSD: first.bEscrowDemoUSD, bEscrowAfterDemoUSD: last.bEscrowDemoUSD, buyerGrantSpentBeforeBaseUnits: first.grant.spent, buyerGrantSpentAfterBaseUnits: last.grant.spent, buyerGrantLockedBaseUnits: last.grant.locked };
    report.acceptance = { twoIndependentSellerWallets: true, twoDistinctProviderProcessesObservedOnline: true, twoDifferentChainQuotes: true, explicitSellerBSettled: true, autoShortSelectedB: true, autoLongSelectedA: true, crossWalletSettlementVerified: true, allThreeReceiptOrderAndBalanceChecksPassed: true, allInferenceAndMeteringRemainMock: true };
    report.verifiedAt = new Date().toISOString();
    report.status = 'market_requests_verified';
    save();
  } catch (error) {
    report.status = 'market_verification_incomplete';
    report.lastRunStoppedAt = new Date().toISOString();
    save();
    throw error;
  } finally {
    if (keyId) {
      await api(`/api-keys/${keyId}`, { token: sessionToken, method: 'DELETE', expectedStatus: 204 });
      const remaining = await api('/api-keys', { token: sessionToken });
      assert.ok(remaining.data.some((key: Json) => key.id === keyId && key.revokedAt));
      if (keyToken) await api('/v1/requests', { token: keyToken, expectedStatus: 401 });
      report.temporaryApiKey = { ...report.temporaryApiKey, revoked: true, rejectedAfterRevocation: true, revokedAt: new Date().toISOString() };
      save();
    }
    keyToken = undefined;
  }
  printSummary(report);
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || (args.length === 1 && args[0] === '--plan')) {
    console.log(JSON.stringify({ mode: 'plan-only', sendsRequestsOrTransactions: false, plan: marketPlan() }, null, 2));
    return;
  }
  if (args.length === 1 && args[0] === '--summary') {
    const report = readJson(evidencePath);
    assert.equal(report.status, 'market_requests_verified');
    assert.equal(report.aggregate.count, 3);
    assert.equal(report.temporaryApiKey.revoked, true);
    assert.equal(report.temporaryApiKey.rejectedAfterRevocation, true);
    const cases = marketPlan().map(item => {
      const entry = report.cases[item.name];
      assert.equal(entry.submissionState, 'verified');
      assert.equal(entry.bill.providerId, item.expectedProviderId);
      assert.equal(entry.bill.outcome, item.expectedOutcome);
      return entry as Json;
    });
    assert.equal(decimal(cases.reduce((sum, entry) => sum + BigInt(entry.order.charged), 0n)), report.aggregate.totalBuyerAuthorizationSpentDemoUSD);
    for (const failed of report.failedAttempts ?? []) assert.equal(units(failed.chargedDemoUSD), 0n);
    // Exercise the same summary path with bigint grant counters as produced by live RPC reads.
    for (const key of ['buyerGrantSpentBeforeBaseUnits', 'buyerGrantSpentAfterBaseUnits', 'buyerGrantLockedBaseUnits']) report.aggregate[key] = BigInt(report.aggregate[key]);
    printSummary(report);
    return;
  }
  if (args[0] === '--verify-quote-b') {
    assert.ok(args.length === 2 && /^0x[a-f0-9]{64}$/i.test(args[1]!), 'Supply the public seller B upsertQuote transaction hash');
    await verifyQuoteB(args[1] as Hex);
    return;
  }
  assert.equal(args[0], '--execute', 'Use --plan (default, offline), --verify-quote-b HASH (read-only RPC), or --execute (three bounded real testnet requests)');
  const recoveries = new Map<string, string>();
  let retryLockFailed = false;
  for (let index = 1; index < args.length; index++) {
    if (args[index] === '--retry-lock-failed') {
      assert.equal(args[++index], 'auto_long_a', 'The bounded explicit retry is only available for auto_long_a');
      assert.equal(retryLockFailed, false);
      retryLockFailed = true;
      continue;
    }
    assert.equal(args[index], '--recover');
    const match = args[++index]?.match(/^(explicit_b|auto_short_b|auto_long_a)=([a-f0-9-]{36})$/i);
    assert.ok(match, 'Use --recover CASE=KNOWN_REQUEST_ID only after inspecting an ambiguous submission');
    recoveries.set(match[1]!, match[2]!);
  }
  mkdirSync(new URL('../.local/', import.meta.url), { recursive: true, mode: 0o700 });
  const lock = openSync(lockPath, 'wx', 0o600);
  try { await execute(recoveries, retryLockFailed); } finally { closeSync(lock); unlinkSync(lockPath); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    // Never print arbitrary signer/network errors, response bodies, challenges, signatures or keys.
    console.error(error instanceof assert.AssertionError ? error.message : 'Market smoke stopped. Check the public evidence for any known request and rerun to query it; no automatic replacement is submitted. Session and key details are not logged.');
    process.exitCode = 1;
  });
}
