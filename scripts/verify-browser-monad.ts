import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPublicClient, decodeFunctionData, formatEther, formatUnits, getAddress, http, isAddress, keccak256, parseEther, parseUnits, stringToHex, type Abi, type Hex } from 'viem';
import { monadTestnet } from 'viem/chains';

// Read-only verification: no wallet client, account secrets, UI state, signing or transaction submission.
const buyerInput = '0xbc81a46f5eee3924aa0b7fd8849ea08351194a75';
assert.ok(isAddress(buyerInput), 'The browser wallet address must be a valid EVM address');
const buyer = getAddress(buyerInput);
const root = new URL('../', import.meta.url);
const evidencePath = new URL('contracts/deployments/inferpool-smoke-browser-monad.json', root);
const readJson = (path: URL) => JSON.parse(readFileSync(path, 'utf8'));
const deployment = readJson(new URL('contracts/deployments/inferpool-monad-testnet.json', root));
assert.equal(deployment.chainId, 10143);
const market = getAddress(deployment.market);
const token = getAddress(deployment.token);
const seller = getAddress(deployment.router);
assert.notEqual(buyer, seller, 'Browser buyer and current seller/router must have different addresses');
const marketAbi = readJson(new URL('contracts/out/InferenceMarket.sol/InferenceMarket.json', root)).abi as Abi;
const tokenAbi = readJson(new URL('contracts/out/DemoUSD.sol/DemoUSD.json', root)).abi as Abi;
const client = createPublicClient({ chain: monadTestnet, transport: http(deployment.rpcUrl) });
const args = process.argv.slice(2);
let requestId: string | undefined;
let caseName = 'normal';
const caseOutcomes: Record<string, number> = { normal: 0, extra_normal: 0, seller_failed: 3, extra_timeout: 3, budget_cap: 2, budget_capped: 2, cache_write: 0, cache_read: 0, cache_hit: 0, buyer_cancelled: 1 };
let expectedBudget = '0.1';
let expectedUsage: number[] | undefined;
let routerFundingHash: Hex | undefined;
const transactions: { label: string; hash: Hex }[] = [];
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--request-id') {
    requestId = args[++index];
    assert.ok(requestId && /^[a-zA-Z0-9-]{1,128}$/.test(requestId), 'Invalid public request ID');
  } else if (args[index] === '--case') {
    caseName = args[++index] ?? '';
    assert.ok(Object.hasOwn(caseOutcomes, caseName), 'Unsupported browser verification case');
  } else if (args[index] === '--usage') {
    const usage = args[++index];
    assert.ok(usage && /^\d+,\d+,\d+,\d+$/.test(usage), 'Use --usage input,cacheRead,cacheWrite,output');
    expectedUsage = usage.split(',').map(Number);
    assert.ok(expectedUsage.every(value => Number.isSafeInteger(value) && value >= 0));
  } else if (args[index] === '--budget') {
    expectedBudget = args[++index] ?? '';
    assert.ok(/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(expectedBudget));
    assert.ok(parseUnits(expectedBudget, 6) > 0n);
  } else if (args[index] === '--router-funding') {
    const hash = args[++index];
    assert.ok(hash && /^0x[0-9a-fA-F]{64}$/.test(hash), 'Expected a public Router funding transaction hash');
    routerFundingHash = hash as Hex;
  } else if (args[index] === '--tx') {
    const match = args[++index]?.match(/^([a-z][a-z0-9_-]{0,40})=(0x[0-9a-fA-F]{64})$/);
    assert.ok(match, 'Use --tx label=0xTRANSACTION_HASH');
    transactions.push({ label: match[1]!, hash: match[2] as Hex });
  } else throw new Error('Supported arguments: --tx label=hash, --router-funding hash, --request-id id, --case normal|seller_failed|budget_cap|cache_write|cache_read|buyer_cancelled, --budget decimal and --usage input,cacheRead,cacheWrite,output');
}

async function main() {
  assert.equal(await client.getChainId(), 10143);
  const funding = transactions.find(entry => entry.label === 'faucet_native');
  const fundingReceipt = funding ? await client.getTransactionReceipt({ hash: funding.hash }) : undefined;
  // On the first run, reconstruct the buyer's state immediately before the supplied funding receipt.
  // This avoids mistaking an already funded browser for an observed zero-balance wallet.
  const block = fundingReceipt && !existsSync(evidencePath)
    ? await client.getBlock({ blockNumber: fundingReceipt.blockNumber - 1n })
    : await client.getBlock();
  const blockNumber = block.number;
  const marketRead = (functionName: string, values: readonly unknown[] = []) => client.readContract({ address: market, abi: marketAbi, functionName, args: values, blockNumber });
  const tokenRead = (functionName: string, values: readonly unknown[] = []) => client.readContract({ address: token, abi: tokenAbi, functionName, args: values, blockNumber });
  assert.equal(getAddress(await marketRead('token') as string), token);
  assert.equal(getAddress(await marketRead('router') as string), seller);
  assert.equal(await tokenRead('IS_DEMO_ASSET'), true);
  const [native, walletTokens, escrow, allowance, claimed, grantId, quote] = await Promise.all([
    client.getBalance({ address: buyer, blockNumber }), tokenRead('balanceOf', [buyer]), marketRead('balances', [buyer]),
    tokenRead('allowance', [buyer, market]), tokenRead('hasClaimed', [buyer]), marketRead('activeGrantId', [buyer]),
    marketRead('getQuote', [seller, keccak256(stringToHex('mock-reasoner'))]),
  ]);
  const grant = await marketRead('getGrant', [buyer, grantId]) as { totalLimit: bigint; spent: bigint; locked: bigint; expiresAt: bigint; revoked: boolean };
  const remaining = grant.totalLimit - grant.spent - grant.locked;
  const authorization = grant.revoked || grant.expiresAt <= block.timestamp ? 0n : remaining > 0n ? remaining : 0n;
  const snapshot = {
    observedAt: new Date().toISOString(), blockNumber: blockNumber.toString(), blockTimestamp: block.timestamp.toString(), buyer,
    nativeBalanceWei: native.toString(), nativeBalanceMON: formatEther(native),
    walletDemoUSD: formatUnits(walletTokens as bigint, 6), escrowAvailableDemoUSD: formatUnits(escrow as bigint, 6),
    tokenAllowanceDemoUSD: formatUnits(allowance as bigint, 6), faucetClaimed: claimed,
    grantId, grant, authorizationAvailableDemoUSD: formatUnits(authorization, 6), sellerQuote: quote,
  };
  const report = existsSync(evidencePath) ? readJson(evidencePath) : {
    network: 'monad-testnet', chainId: 10143, buyer, seller, router: seller, market, token,
      scope: 'Read-only RPC evidence for a browser-created Para buyer wallet distinct from the existing Alchemy session seller/router. Inference and token metering remain MOCK. Initial state alone is not a completed browser acceptance test.',
    walletAddressValidated: true, buyerDiffersFromSeller: true, initial: snapshot, transactions: {},
  };
  assert.equal(getAddress(report.buyer), buyer);
  assert.equal(getAddress(report.market), market);
  report.latest = snapshot;
  for (const entry of transactions) {
    const [receipt, transaction] = await Promise.all([client.getTransactionReceipt({ hash: entry.hash }), client.getTransaction({ hash: entry.hash })]);
    assert.equal(receipt.status, 'success', `${entry.label} receipt must succeed`);
    assert.ok(entry.label === 'faucet_native' || [buyer, seller].includes(getAddress(receipt.from)), 'Unexpected transaction sender');
    assert.ok(receipt.to && [buyer, market, token].includes(getAddress(receipt.to)), 'Unexpected transaction target');
    const contractAbi = getAddress(receipt.to!) === token ? tokenAbi : getAddress(receipt.to!) === market ? marketAbi : undefined;
    const decoded = contractAbi ? decodeFunctionData({ abi: contractAbi, data: transaction.input }) : undefined;
    const expectedFunction: Record<string, string> = { faucet_dusd: 'faucet', approve: 'approve', deposit: 'deposit', authorize: 'authorizeRouter', reserve: 'reserve', settle: 'settle' };
    if (entry.label === 'faucet_native') {
      assert.equal(getAddress(receipt.to!), buyer);
      assert.equal(transaction.value, parseEther('1'));
      assert.equal(transaction.input, '0x');
    } else if (expectedFunction[entry.label]) {
      assert.equal(decoded?.functionName, expectedFunction[entry.label]);
      assert.equal(getAddress(receipt.from), ['reserve', 'settle'].includes(entry.label) ? seller : buyer);
      assert.equal(getAddress(receipt.to!), ['faucet_dusd', 'approve'].includes(entry.label) ? token : market);
      if (entry.label === 'approve') assert.deepEqual(decoded?.args, [market, parseUnits('10', 6)]);
      if (entry.label === 'deposit') assert.deepEqual(decoded?.args, [parseUnits('10', 6)]);
      if (entry.label === 'authorize') {
        const values = decoded?.args as readonly [bigint, bigint];
        assert.equal(values[0], parseUnits('5', 6));
        assert.equal(values[1], BigInt(Date.parse('2026-09-06T12:40:10+08:00') / 1000));
        const authorizationBlock = await client.getBlock({ blockNumber: receipt.blockNumber });
        assert.ok(values[1] > authorizationBlock.timestamp);
        assert.ok(values[1] <= authorizationBlock.timestamp + 86400n);
        const [buyerEscrow, sellerEscrow, activeGrantId] = await Promise.all([
          client.readContract({ address: market, abi: marketAbi, functionName: 'balances', args: [buyer], blockNumber: receipt.blockNumber }),
          client.readContract({ address: market, abi: marketAbi, functionName: 'balances', args: [seller], blockNumber: receipt.blockNumber }),
          client.readContract({ address: market, abi: marketAbi, functionName: 'activeGrantId', args: [buyer], blockNumber: receipt.blockNumber }),
        ]);
        const authorizedGrant = await client.readContract({ address: market, abi: marketAbi, functionName: 'getGrant', args: [buyer, activeGrantId], blockNumber: receipt.blockNumber }) as typeof grant;
        assert.equal(authorizedGrant.totalLimit, parseUnits('5', 6));
        assert.equal(authorizedGrant.spent, 0n);
        assert.equal(authorizedGrant.locked, 0n);
        assert.equal(authorizedGrant.expiresAt, values[1]);
        assert.equal(authorizedGrant.revoked, false);
        report.preRequest = { snapshotSource: 'Historical state at the confirmed buyer authorization block, before the browser request', blockNumber: receipt.blockNumber, blockTimestamp: authorizationBlock.timestamp, authorizationTransactionHash: entry.hash, buyer, seller, buyerEscrowBaseUnits: buyerEscrow, buyerEscrowDemoUSD: formatUnits(buyerEscrow as bigint, 6), sellerEscrowBaseUnits: sellerEscrow, sellerEscrowDemoUSD: formatUnits(sellerEscrow as bigint, 6), grantId: activeGrantId, grant: authorizedGrant };
      }
    }
    const evidenceLabel = ['reserve', 'settle'].includes(entry.label) ? `${caseName}_${entry.label}` : entry.label;
    report.transactions[evidenceLabel] = {
      transactionHash: entry.hash, from: getAddress(receipt.from), to: getAddress(receipt.to!), status: receipt.status,
      functionName: decoded?.functionName, args: decoded?.args, valueWei: transaction.value.toString(), blockNumber: receipt.blockNumber.toString(),
      gasLimit: transaction.gas.toString(), gasUsed: receipt.gasUsed.toString(), effectiveGasPrice: receipt.effectiveGasPrice.toString(),
      monadGasLimitCostWei: (transaction.gas * receipt.effectiveGasPrice).toString(), explorerUrl: `https://testnet.monadscan.com/tx/${entry.hash}`,
    };
  }
  if (requestId) {
    const onchainRequestId = keccak256(stringToHex(requestId));
    const order = await marketRead('getOrder', [onchainRequestId]) as Record<string, any>;
    assert.equal(getAddress(order.buyer), buyer);
    assert.equal(getAddress(order.provider), seller);
    assert.equal(order.modelId, keccak256(stringToHex('mock-reasoner')));
    assert.equal(Number(order.state), 2, 'Browser request must have settled on Monad');
    assert.equal(Number(order.outcome), caseOutcomes[caseName]);
    assert.equal(BigInt(order.quoteVersion), 1n);
    assert.equal(BigInt(order.reserved), parseUnits(expectedBudget, 6));
    const buckets = ['input', 'cacheRead', 'cacheWrite', 'output'];
    const expectedPrices = ['30', '3', '37.5', '80'];
    let numerator = 0n;
    for (let index = 0; index < buckets.length; index++) {
      const bucket = buckets[index]!;
      assert.equal(BigInt(order.prices[bucket]), parseUnits(expectedPrices[index]!, 6));
      if (expectedUsage) assert.equal(BigInt(order.usage[bucket]), BigInt(expectedUsage[index]!));
      numerator += BigInt(order.prices[bucket]) * BigInt(order.usage[bucket]);
    }
    const charged = caseOutcomes[caseName]! >= 3 ? 0n : (numerator + 999999n) / 1000000n;
    assert.equal(BigInt(order.charged), charged);
    assert.ok(order.charged <= order.reserved);
    if (['budget_cap', 'budget_capped'].includes(caseName)) assert.ok((numerator + BigInt(order.prices.output) + 999999n) / 1000000n > BigInt(order.reserved), 'One additional mock output unit must exceed this spending budget');
    const reserveTx = report.transactions[`${caseName}_reserve`];
    const settleTx = report.transactions[`${caseName}_settle`];
    assert.ok(reserveTx && settleTx, 'Supply both reserve and settle transaction hashes for this case');
    assert.equal(reserveTx.args[0], onchainRequestId);
    assert.equal(getAddress(reserveTx.args[1]), buyer);
    assert.equal(getAddress(reserveTx.args[2]), seller);
    assert.equal(reserveTx.args[3], order.modelId);
    assert.equal(BigInt(reserveTx.args[4]), BigInt(order.reserved));
    assert.equal(BigInt(reserveTx.args[6]), BigInt(order.quoteVersion));
    assert.equal(settleTx.args[0], onchainRequestId);
    assert.equal(Number(settleTx.args[2]), Number(order.outcome));
    for (const bucket of buckets) assert.equal(BigInt(settleTx.args[1][bucket]), BigInt(order.usage[bucket]));
    const reserveBlock = BigInt(reserveTx.blockNumber);
    const settleBlock = BigInt(settleTx.blockNumber);
    assert.ok(reserveBlock < settleBlock);
    const balancesAt = async (at: bigint) => {
      const [buyerBalance, sellerBalance, spendingGrant] = await Promise.all([
        client.readContract({ address: market, abi: marketAbi, functionName: 'balances', args: [buyer], blockNumber: at }),
        client.readContract({ address: market, abi: marketAbi, functionName: 'balances', args: [seller], blockNumber: at }),
        client.readContract({ address: market, abi: marketAbi, functionName: 'getGrant', args: [buyer, order.grantId], blockNumber: at }),
      ]);
      return { blockNumber: at, buyerEscrowBaseUnits: buyerBalance as bigint, sellerEscrowBaseUnits: sellerBalance as bigint, buyerEscrowDemoUSD: formatUnits(buyerBalance as bigint, 6), sellerEscrowDemoUSD: formatUnits(sellerBalance as bigint, 6), grant: spendingGrant as typeof grant };
    };
    const [beforeReserve, afterReserve, afterSettle] = await Promise.all([balancesAt(reserveBlock - 1n), balancesAt(reserveBlock), balancesAt(settleBlock)]);
    assert.equal(afterReserve.buyerEscrowBaseUnits, beforeReserve.buyerEscrowBaseUnits - BigInt(order.reserved));
    assert.equal(afterReserve.sellerEscrowBaseUnits, beforeReserve.sellerEscrowBaseUnits);
    assert.equal(afterReserve.grant.locked, beforeReserve.grant.locked + BigInt(order.reserved));
    assert.equal(afterReserve.grant.spent, beforeReserve.grant.spent);
    assert.equal(afterSettle.buyerEscrowBaseUnits, beforeReserve.buyerEscrowBaseUnits - charged);
    assert.equal(afterSettle.sellerEscrowBaseUnits, beforeReserve.sellerEscrowBaseUnits + charged);
    assert.equal(afterSettle.grant.spent, beforeReserve.grant.spent + charged);
    assert.equal(afterSettle.grant.locked, beforeReserve.grant.locked);
    assert.equal(afterSettle.grant.locked, 0n);
    report.cases ??= {};
    report.cases[caseName] = { requestId, onchainRequestId, order, chargeDemoUSD: formatUnits(charged, 6), releasedDemoUSD: formatUnits(BigInt(order.reserved) - charged, 6), settledOnchain: true, expectedUiUsage: expectedUsage, quoteAndUsageChecked: true, buyerSellerBalancesChecked: true, grantSpentAndLockedChecked: true, reserveTransactionHash: reserveTx.transactionHash, settleTransactionHash: settleTx.transactionHash, snapshots: { beforeReserve, afterReserve, afterSettle }, verifiedAt: new Date().toISOString() };
    if (caseName === 'extra_normal') report.cases[caseName].browserObservation = 'The first cancellation attempt arrived after mock inference had already completed. This is an additional successful paid request and does not demonstrate buyer cancellation.';
    if (caseName === 'extra_timeout') report.cases[caseName].browserObservation = 'The second browser cancellation attempt hit a CDP automation timeout and did not cancel the request. The slow Provider reached the Router seller timeout instead. This is SellerFailed with zero fee, not proof of successful buyer cancellation.';
    const writeCase = report.cases.cache_write;
    const readCase = report.cases.cache_read ?? report.cases.cache_hit;
    if (writeCase && readCase) {
      assert.equal(getAddress(writeCase.order.buyer), getAddress(readCase.order.buyer));
      assert.equal(getAddress(writeCase.order.provider), getAddress(readCase.order.provider));
      assert.equal(writeCase.order.modelId, readCase.order.modelId);
      assert.equal(BigInt(writeCase.order.quoteVersion), BigInt(readCase.order.quoteVersion));
      assert.equal(BigInt(writeCase.order.usage.cacheWrite), BigInt(readCase.order.usage.cacheRead));
      assert.equal(BigInt(writeCase.order.usage.input) + BigInt(writeCase.order.usage.cacheRead), 0n);
      assert.equal(BigInt(readCase.order.usage.input) + BigInt(readCase.order.usage.cacheWrite), 0n);
      assert.ok(BigInt(writeCase.snapshots.afterSettle.blockNumber) < BigInt(readCase.snapshots.afterReserve.blockNumber));
      report.cachePair = { writeRequestId: writeCase.requestId, readRequestId: readCase.requestId, sameBuyerSellerModelAndQuoteVersion: true, mutuallyExclusiveInputBucketsVerified: true, simulatedInputUnits: Number(writeCase.order.usage.cacheWrite), cacheWritePricePerMillion: formatUnits(BigInt(writeCase.order.prices.cacheWrite), 6), cacheReadPricePerMillion: formatUnits(BigInt(readCase.order.prices.cacheRead), 6), limitation: 'These are Router-classified MOCK cache units, not proof of a real model cache. Identical browser prompt/context was observed by the browser operator; the contract proves bucket accounting and settlement.' };
    }
  }
  if (routerFundingHash) {
    const [receipt, transaction] = await Promise.all([client.waitForTransactionReceipt({ hash: routerFundingHash, confirmations: 1, timeout: 60_000 }), client.getTransaction({ hash: routerFundingHash })]);
    assert.equal(receipt.status, 'success');
    assert.ok(receipt.to);
    assert.equal(getAddress(receipt.to), seller);
    assert.equal(transaction.value, parseEther('1'));
    assert.equal(transaction.input, '0x');
    const [before, after] = await Promise.all([client.getBalance({ address: seller, blockNumber: receipt.blockNumber - 1n }), client.getBalance({ address: seller, blockNumber: receipt.blockNumber })]);
    assert.equal(after - before, parseEther('1'));
    report.routerFunding = { purpose: 'Restore demonstration Router test MON gas balance after the eight business requests; not buyer funding or an inference payment', transactionHash: routerFundingHash, from: getAddress(receipt.from), to: getAddress(receipt.to), receiptStatus: receipt.status, valueWei: transaction.value, valueMON: formatEther(transaction.value), blockNumber: receipt.blockNumber, balanceBeforeWei: before, balanceBeforeMON: formatEther(before), balanceAfterWei: after, balanceAfterMON: formatEther(after), balanceIncreaseVerifiedMON: '1', explorerUrl: `https://testnet.monadscan.com/tx/${routerFundingHash}`, verifiedAt: new Date().toISOString() };
  }
  report.updatedAt = new Date().toISOString();
  // Always record a current balance read, even when the initial snapshot was reconstructed historically.
  const latestBlock = await client.getBlock();
  const latestGrantId = await client.readContract({ address: market, abi: marketAbi, functionName: 'activeGrantId', args: [buyer], blockNumber: latestBlock.number });
  const [latestNative, latestTokens, latestEscrow, latestGrant] = await Promise.all([
    client.getBalance({ address: buyer, blockNumber: latestBlock.number }),
    client.readContract({ address: token, abi: tokenAbi, functionName: 'balanceOf', args: [buyer], blockNumber: latestBlock.number }),
    client.readContract({ address: market, abi: marketAbi, functionName: 'balances', args: [buyer], blockNumber: latestBlock.number }),
    client.readContract({ address: market, abi: marketAbi, functionName: 'getGrant', args: [buyer, latestGrantId], blockNumber: latestBlock.number }),
  ]);
  report.currentAccount = { observedAt: report.updatedAt, blockNumber: latestBlock.number, nativeBalanceWei: latestNative, nativeBalanceMON: formatEther(latestNative), walletDemoUSD: formatUnits(latestTokens as bigint, 6), escrowAvailableDemoUSD: formatUnits(latestEscrow as bigint, 6), grantId: latestGrantId, grant: latestGrant };
  const [routerNative, gasPrice] = await Promise.all([client.getBalance({ address: seller, blockNumber: latestBlock.number }), client.getGasPrice()]);
  const observedOrderGas = Object.keys(report.cases ?? {}).map(name => BigInt(report.transactions[`${name}_reserve`].gasLimit) + BigInt(report.transactions[`${name}_settle`].gasLimit));
  const maxOrderGas = observedOrderGas.reduce((max, value) => value > max ? value : max, 0n);
  const estimatedFourOrdersWei = (maxOrderGas * gasPrice * 4n * 120n + 99n) / 100n;
  report.routerGasReadiness = { observedAt: report.updatedAt, blockNumber: latestBlock.number, router: seller, nativeBalanceWei: routerNative, nativeBalanceMON: formatEther(routerNative), currentGasPriceWei: gasPrice, largestObservedReserveAndSettleGasLimit: maxOrderGas, estimatedFourOrdersWith20PercentMarginWei: estimatedFourOrdersWei, estimatedFourOrdersWith20PercentMarginMON: formatEther(estimatedFourOrdersWei), sufficientAtObservedGasPrice: maxOrderGas > 0n && routerNative >= estimatedFourOrdersWei, estimateBasis: 'Largest gas-limit sum among verified browser cases, multiplied by current gas price and four requests, plus 20%. This estimate does not guarantee future gas prices.' };
  const verifiedCases = Object.values(report.cases ?? {}) as Record<string, any>[];
  verifiedCases.sort((left, right) => Number(BigInt(left.snapshots.beforeReserve.blockNumber) - BigInt(right.snapshots.beforeReserve.blockNumber)));
  if (verifiedCases.length) {
    const totalCharged = verifiedCases.reduce((total, entry) => total + BigInt(entry.order.charged), 0n);
    const first = verifiedCases[0]!.snapshots.beforeReserve;
    const last = verifiedCases.at(-1)!.snapshots.afterSettle;
    assert.equal(BigInt(first.buyerEscrowBaseUnits) - BigInt(last.buyerEscrowBaseUnits), totalCharged);
    assert.equal(BigInt(last.sellerEscrowBaseUnits) - BigInt(first.sellerEscrowBaseUnits), totalCharged);
    assert.equal(BigInt(last.grant.spent) - BigInt(first.grant.spent), totalCharged);
    report.verifiedCasesAggregate = { requestCount: verifiedCases.length, totalChargedBaseUnits: totalCharged, totalChargedDemoUSD: formatUnits(totalCharged, 6), buyerBalanceBeforeDemoUSD: first.buyerEscrowDemoUSD, buyerBalanceAfterDemoUSD: last.buyerEscrowDemoUSD, sellerBalanceBeforeDemoUSD: first.sellerEscrowDemoUSD, sellerBalanceAfterDemoUSD: last.sellerEscrowDemoUSD, grantSpentBaseUnitsAfter: last.grant.spent, grantLockedBaseUnitsAfter: last.grant.locked, startBlock: first.blockNumber, endBlock: last.blockNumber, buyerDebitEqualsSellerCreditAndGrantSpent: true };
  }
  const requiredCases = ['normal', 'seller_failed', 'budget_cap', 'cache_write', 'cache_read', 'buyer_cancelled'];
  report.verificationStatus = { requiredCases, verifiedCases: Object.keys(report.cases ?? {}), allRequiredCasesSettledAndVerified: requiredCases.every(name => report.cases?.[name]?.settledOnchain), independentBuyerAndSellerWallets: true, twoIndependentSellersVerified: false, mockInferenceAndMetering: true, browserInteractionsSource: 'Observed and executed by the parent browser operator; this script independently verifies public on-chain results only.' };
  writeFileSync(evidencePath, JSON.stringify(report, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2) + '\n');
  console.log(JSON.stringify({ verification: requestId ? 'browser-order-settled' : 'initial-state-recorded', evidence: fileURLToPath(evidencePath), buyer, seller, blockNumber: blockNumber.toString(), nativeBalanceMON: snapshot.nativeBalanceMON, walletDemoUSD: snapshot.walletDemoUSD, escrowAvailableDemoUSD: snapshot.escrowAvailableDemoUSD, authorizationAvailableDemoUSD: snapshot.authorizationAvailableDemoUSD, faucetClaimed: claimed, checkedTransactions: transactions.length, requestId }));
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'Read-only browser verification failed'); process.exitCode = 1; });
