import assert from 'node:assert/strict';
import test from 'node:test';
import { validateFailedRetryEvidence } from './smoke-market-monad.js';

const proof = () => ({ bill: { status: 'lock_failed', settlement: 'unsubmitted', deadline: 1000, usage: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }, output: '', charge: '0.000000' }, order: { state: 0, reserved: 0n, charged: 0n }, blockTimestamp: 1002n, pendingNonce: 34, latestNonce: 34, nowSeconds: 1002 });

test('explicit failed-lock retry accepts only an expired, absent, unused order with no pending nonce', () => {
  assert.doesNotThrow(() => validateFailedRetryEvidence(proof()));
});

test('a wall-clock expiry alone cannot permit retry before chain time has passed the deadline', () => {
  assert.throws(() => validateFailedRetryEvidence({ ...proof(), blockTimestamp: 1000n }));
  assert.throws(() => validateFailedRetryEvidence({ ...proof(), nowSeconds: 1000 }));
});

test('uncertain or submitted reservations must not be replaced', () => {
  const value = proof();
  assert.throws(() => validateFailedRetryEvidence({ ...value, bill: { ...value.bill, status: 'reservation_unknown' } }));
  assert.throws(() => validateFailedRetryEvidence({ ...value, bill: { ...value.bill, settlement: 'confirmed' } }));
  assert.throws(() => validateFailedRetryEvidence({ ...value, bill: { ...value.bill, lockTx: '0x1234' } }));
  assert.throws(() => validateFailedRetryEvidence({ ...value, order: { ...value.order, state: 1, reserved: 100000n } }));
});

test('any metering, charged amount, output or pending wallet transaction blocks retry', () => {
  const value = proof();
  assert.throws(() => validateFailedRetryEvidence({ ...value, bill: { ...value.bill, usage: { ...value.bill.usage, output: 1 } } }));
  assert.throws(() => validateFailedRetryEvidence({ ...value, bill: { ...value.bill, charge: '0.000001' } }));
  assert.throws(() => validateFailedRetryEvidence({ ...value, bill: { ...value.bill, output: 'x' } }));
  assert.throws(() => validateFailedRetryEvidence({ ...value, pendingNonce: 35 }));
});
