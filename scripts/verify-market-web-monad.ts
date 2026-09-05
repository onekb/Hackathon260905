import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeFunctionData, getAddress, type Hex } from 'viem';
import { opaqueId } from '../server/src/evm-chain.js';
import { decimal, fee, units } from '../server/src/money.js';
import { expectedSigner, model, monadContext, readJson, receiptEvidence, saveJson } from './setup-monad.js';

// Read-only receipt/ledger verification for the operator-observed browser manual-selection case.
// No wallet session, credential, signature, transaction or inference request is created here.
const args = process.argv.slice(2);
assert.ok(args.length === 2 && args[0] === '--request-id' && /^[a-f0-9-]{36}$/i.test(args[1]!), 'Use --request-id KNOWN_BROWSER_REQUEST_ID');
const requestId = args[1]!;
const buyer = getAddress('0xbc81a46f5eee3924aa0b7fd8849ea08351194a75');
const seller = expectedSigner;
const path = new URL('../contracts/deployments/inferpool-smoke-market-monad.json', import.meta.url);
const ledgerPath = process.env.ROUTER_STATE_PATH ?? new URL('../.local/monad-router-state.json', import.meta.url);
const buckets = ['input', 'cacheRead', 'cacheWrite', 'output'] as const;
const quoteA = { input: '30', cacheRead: '3', cacheWrite: '37.5', output: '80', minReserve: '0.0001' };
const quoteB = { input: '60', cacheRead: '6', cacheWrite: '75', output: '40', minReserve: '0.0001' };
type Json = Record<string, any>;

async function main() {
  const ctx = await monadContext();
  const report = readJson(path);
  assert.equal(report.status, 'market_requests_verified');
  assert.equal(report.aggregate.count, 3, 'Keep the three API cases and this browser case separate');
  const preservedAggregate = JSON.stringify(report.aggregate);
  const preservedCases = JSON.stringify(report.cases);
  // Select this one public order only; authentication/API-key records are never copied or printed.
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  const bill: Json = ledger.orders[requestId];
  assert.ok(bill, 'Known browser request must exist in the Router ledger');
  assert.equal(getAddress(bill.buyer), buyer);
  assert.equal(getAddress(bill.seller), seller);
  assert.equal(bill.providerId, 'seller-monad');
  assert.equal(bill.model, model);
  assert.equal(bill.status, 'completed');
  assert.equal(bill.settlement, 'confirmed');
  assert.equal(bill.outcome, 0);
  assert.equal(bill.mock, true);
  assert.equal(bill.cacheMode, 'none');
  assert.equal(bill.maxTokens, 512);
  assert.deepEqual(bill.usage, { input: 54, cacheRead: 0, cacheWrite: 0, output: 187 });
  assert.equal(bill.budget, '0.100000');
  assert.equal(bill.charge, '0.016580');
  assert.equal(bill.released, '0.083420');
  assert.equal(fee(quoteA, bill.usage), units(bill.charge));
  assert.match(bill.lockTx, /^0x[a-f0-9]{64}$/i);
  assert.match(bill.settlementTx, /^0x[a-f0-9]{64}$/i);
  const [reserve, settle, reserveTx, settleTx, rawOrder] = await Promise.all([
    receiptEvidence(ctx, bill.lockTx as Hex), receiptEvidence(ctx, bill.settlementTx as Hex),
    ctx.client.getTransaction({ hash: bill.lockTx as Hex }), ctx.client.getTransaction({ hash: bill.settlementTx as Hex }),
    ctx.client.readContract({ address: ctx.market, abi: ctx.marketAbi, functionName: 'getOrder', args: [opaqueId(requestId)] }),
  ]);
  const order = rawOrder as Json;
  assert.equal(getAddress(reserve.to!), ctx.market);
  assert.equal(getAddress(settle.to!), ctx.market);
  assert.equal(getAddress(order.buyer), buyer);
  assert.equal(getAddress(order.provider), seller);
  assert.equal(order.modelId, opaqueId(model));
  assert.equal(Number(order.state), 2);
  assert.equal(Number(order.outcome), 0);
  assert.equal(order.quoteVersion, 1n);
  assert.equal(order.reserved, units('0.1'));
  assert.equal(order.charged, units('0.016580'));
  for (const bucket of buckets) {
    assert.equal(order.usage[bucket], BigInt(bill.usage[bucket]));
    assert.equal(order.prices[bucket], units(quoteA[bucket]));
  }
  const reserveCall = decodeFunctionData({ abi: ctx.marketAbi, data: reserveTx.input });
  const settleCall = decodeFunctionData({ abi: ctx.marketAbi, data: settleTx.input });
  assert.equal(reserveCall.functionName, 'reserve');
  assert.equal(settleCall.functionName, 'settle');
  const lockArgs = reserveCall.args as readonly any[];
  const settleArgs = settleCall.args as readonly any[];
  assert.equal(lockArgs[0], opaqueId(requestId));
  assert.equal(getAddress(lockArgs[1]), buyer);
  assert.equal(getAddress(lockArgs[2]), seller);
  assert.equal(lockArgs[3], opaqueId(model));
  assert.equal(lockArgs[4], order.reserved);
  assert.equal(lockArgs[6], order.quoteVersion);
  assert.equal(settleArgs[0], opaqueId(requestId));
  assert.equal(Number(settleArgs[2]), 0);
  for (const bucket of buckets) assert.equal(settleArgs[1][bucket], order.usage[bucket]);
  const reserveBlock = BigInt(reserve.blockNumber);
  const settleBlock = BigInt(settle.blockNumber);
  assert.ok(reserveBlock < settleBlock);
  const marketRead = (functionName: string, values: readonly unknown[], blockNumber: bigint) => ctx.client.readContract({ address: ctx.market, abi: ctx.marketAbi, functionName, args: values, blockNumber });
  const snapshot = async (blockNumber: bigint) => {
    const [buyerBalance, sellerBalance, grant] = await Promise.all([
      marketRead('balances', [buyer], blockNumber), marketRead('balances', [seller], blockNumber), marketRead('getGrant', [buyer, order.grantId], blockNumber),
    ]);
    return { blockNumber, buyerEscrowBaseUnits: buyerBalance as bigint, sellerEscrowBaseUnits: sellerBalance as bigint, buyerEscrowDemoUSD: decimal(buyerBalance as bigint), sellerEscrowDemoUSD: decimal(sellerBalance as bigint), grant: grant as Json };
  };
  const [beforeReserve, afterReserve, afterSettle, chainQuoteA, chainQuoteB] = await Promise.all([
    snapshot(reserveBlock - 1n), snapshot(reserveBlock), snapshot(settleBlock),
    marketRead('getQuote', [seller, opaqueId(model)], reserveBlock - 1n), marketRead('getQuote', [buyer, opaqueId(model)], reserveBlock - 1n),
  ]);
  for (const [actual, expected] of [[chainQuoteA as Json, quoteA], [chainQuoteB as Json, quoteB]] as const) {
    assert.equal(actual.active, true);
    assert.equal(actual.version, 1n);
    assert.equal(actual.minReserve, units('0.0001'));
    for (const bucket of buckets) assert.equal(actual.prices[bucket], units(expected[bucket]));
  }
  assert.equal(afterReserve.buyerEscrowBaseUnits, beforeReserve.buyerEscrowBaseUnits - order.reserved);
  assert.equal(afterReserve.sellerEscrowBaseUnits, beforeReserve.sellerEscrowBaseUnits);
  assert.equal(afterReserve.grant.locked, beforeReserve.grant.locked + order.reserved);
  assert.equal(afterSettle.buyerEscrowBaseUnits, beforeReserve.buyerEscrowBaseUnits - order.charged);
  assert.equal(afterSettle.sellerEscrowBaseUnits, beforeReserve.sellerEscrowBaseUnits + order.charged);
  assert.equal(afterSettle.grant.spent, beforeReserve.grant.spent + order.charged);
  assert.equal(afterSettle.grant.locked, 0n);
  assert.equal(beforeReserve.grant.locked, 0n);
  assert.equal(afterSettle.buyerEscrowDemoUSD, '9.928253');
  assert.equal(decimal(BigInt(afterSettle.grant.totalLimit) - BigInt(afterSettle.grant.spent) - BigInt(afterSettle.grant.locked)), '4.904913');
  const estimateA = fee(quoteA, { input: 54, cacheRead: 0, cacheWrite: 0, output: 512 });
  const estimateB = fee(quoteB, { input: 54, cacheRead: 0, cacheWrite: 0, output: 512 });
  assert.ok(estimateB < estimateA);
  const response = await fetch('http://127.0.0.1:8793/api/state', { redirect: 'error', signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 200);
  const provider = await response.json() as Json;
  const run = provider.requests.find((entry: Json) => entry.requestId === requestId);
  assert.equal(provider.providerId, 'seller-monad');
  assert.equal(getAddress(provider.wallet), seller);
  if (run) {
    assert.equal(run.status, 'completed');
    assert.equal(run.mode, 'normal');
    assert.deepEqual(run.usage, bill.usage);
  } else assert.equal(report.webManualOverride?.providerExecution?.run?.requestId, requestId);
  report.webManualOverride = {
    requestId, onchainRequestId: opaqueId(requestId), buyer, seller, providerId: bill.providerId,
    operatorObserved: { source: 'Chrome browser DOM and Para signing flow observed by the operator; this verification script does not control or read browser credentials', selectedProviderId: 'seller-monad', bothSellersOnline: true, maxTokens: 512, cacheEnabled: false, serializedMockInputUnits: 54 },
    selectionProof: { automaticEstimateADemoUSD: decimal(estimateA), automaticEstimateBDemoUSD: decimal(estimateB), expectedAutomaticProviderId: 'seller-para', actualProviderId: bill.providerId, explicitSelectionOverridesCheaperAutomaticCandidate: true, chainQuotesBeforeReservation: { a: chainQuoteA, b: chainQuoteB }, limitation: 'The browser operator observed explicit selection and both online sellers. RPC independently verifies prices and the chosen seller; the contract itself does not record whether selection was manual or automatic.' },
    bill: { requestId, status: bill.status, settlement: bill.settlement, outcome: bill.outcome, budget: bill.budget, charge: bill.charge, released: bill.released, usage: bill.usage, mock: bill.mock, cacheMode: bill.cacheMode },
    order, receipts: { reserve: { ...reserve, functionName: reserveCall.functionName, args: lockArgs }, settle: { ...settle, functionName: settleCall.functionName, args: settleArgs } },
    snapshots: { beforeReserve, afterReserve, afterSettle }, crossWalletBtoADemoUSD: decimal(order.charged),
    providerExecution: run ? { observedAt: new Date().toISOString(), providerId: provider.providerId, wallet: seller, walletMode: provider.walletMode, run } : report.webManualOverride.providerExecution,
    separateFromThreeCaseApiAggregate: true, verifiedAt: new Date().toISOString(),
  };
  assert.equal(JSON.stringify(report.aggregate), preservedAggregate);
  assert.equal(JSON.stringify(report.cases), preservedCases);
  report.updatedAt = new Date().toISOString();
  saveJson(path, report);
  console.log(JSON.stringify({ browserManualOverride: 'verified', requestId, charge: bill.charge, buyerBalance: afterSettle.buyerEscrowDemoUSD, sellerBalance: afterSettle.sellerEscrowDemoUSD, originalApiAggregateCount: report.aggregate.count, reserveTx: bill.lockTx, settleTx: bill.settlementTx }));
}

main().catch(error => { console.error(error instanceof assert.AssertionError ? error.message : 'Read-only browser market verification failed; no requests or transactions were submitted.'); process.exitCode = 1; });
