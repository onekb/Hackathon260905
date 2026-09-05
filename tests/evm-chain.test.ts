import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EvmChain } from '../server/src/evm-chain.js';
import { decimal, fee, units } from '../server/src/money.js';
import { deployFixture, rpcUrl } from './fixture.js';

test('real EVM adapter: budget, quote version, cancel, failure, concurrent grants and unilateral timeout', async () => {
  const f = await deployFixture();
  const chain = new EvmChain({ mode: 'anvil', rpcUrl, marketAddress: f.market, routerAddress: f.router });
  await chain.ready();
  const quote = (await chain.getQuote(f.sellerA, f.model))!;
  assert.equal(quote.version, '1');
  const accountBefore = await chain.getAccount(f.buyer);
  assert.equal(accountBefore.available, '100.000000');
  const lock = (id: string, budget = '1', deadline = Math.floor(Date.now() / 1000) + 120) => chain.lock({ id, buyer: f.buyer, seller: f.sellerA, model: f.model, budget, quote, deadline });
  const cancelId = randomUUID();
  const locked = await lock(cancelId);
  assert.match(locked.txHash, /^0x[0-9a-f]{64}$/i);
  const usage = { input: 100, cacheRead: 200, cacheWrite: 50, output: 300 };
  const charged = decimal(fee(quote, usage));
  const cancel = await chain.settle({ id: cancelId, usage, outcome: 1, charge: charged });
  assert.match(cancel.txHash, /^0x[0-9a-f]{64}$/i);
  assert.equal((await chain.getOrder(cancelId)).charge, charged);
  assert.equal((await chain.getAccount(f.sellerA)).available, charged);
  assert.equal((await chain.settle({ id: cancelId, usage, outcome: 1, charge: charged })).txHash, cancel.txHash);
  await assert.rejects(chain.settle({ id: cancelId, usage, outcome: 0, charge: charged }), /different settlement/);

  const failureId = randomUUID();
  const beforeFailure = await chain.getAccount(f.buyer);
  await lock(failureId);
  await chain.settle({ id: failureId, usage, outcome: 3, charge: '0' });
  assert.deepEqual(await chain.getAccount(f.buyer), beforeFailure);

  const overId = randomUUID();
  await lock(overId, '0.001');
  await assert.rejects(chain.settle({ id: overId, usage, outcome: 0, charge: charged }));
  await chain.settle({ id: overId, usage, outcome: 4, charge: '0' });

  const snapId = randomUUID();
  await lock(snapId);
  await f.write(2, 'upsertQuote', [f.modelId, { ...f.prices, output: 900_000_000n }, 100n, true]);
  await assert.rejects(lock(randomUUID()));
  await chain.settle({ id: snapId, usage, outcome: 0, charge: charged });
  assert.equal((await chain.getOrder(snapId)).charge, charged);

  const nextQuote = (await chain.getQuote(f.sellerA, f.model))!;
  const reclaimedId = randomUUID();
  const block = await f.client.getBlock();
  const deadline = Number(block.timestamp) + 10;
  await chain.lock({ id: reclaimedId, buyer: f.buyer, seller: f.sellerA, model: f.model, budget: '1', quote: nextQuote, deadline });
  await f.client.request({ method: 'evm_setNextBlockTimestamp' as any, params: [deadline] as any });
  await f.client.request({ method: 'evm_mine' as any });
  const { opaqueId } = await import('../server/src/evm-chain.js');
  await f.write(1, 'reclaimExpired', [opaqueId(reclaimedId)]);
  assert.equal((await chain.getOrder(reclaimedId)).state, 'refunded');
  await assert.rejects(chain.settle({ id: reclaimedId, usage, outcome: 0, charge: decimal(fee(nextQuote, usage)) }));
  const remaining = await chain.getAccount(f.buyer);
  assert.equal(units(remaining.available), 100_000_000n - units(charged) * 2n);
});
