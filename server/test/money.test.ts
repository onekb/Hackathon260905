import test from 'node:test';
import assert from 'node:assert/strict';
import { ASSET_DECIMALS, ASSET_SCALE, TOKENS_PER_MILLION, decimal, fee, units, type Quote } from '../src/money.js';

const quote = (rates: Partial<Quote> = {}): Quote => ({ input: '0', cacheRead: '0', cacheWrite: '0', output: '0', minReserve: '0', ...rates });

test('native MON uses 18 decimals independently of the one-million inference denominator', () => {
  assert.equal(ASSET_DECIMALS, 18);
  assert.equal(ASSET_SCALE, 1_000_000_000_000_000_000n);
  assert.equal(TOKENS_PER_MILLION, 1_000_000n);
  assert.equal(units('1'), ASSET_SCALE);
  assert.equal(units('0.000000000000000001'), 1n);
  assert.equal(decimal(1n), '0.000000000000000001');
  assert.equal(decimal(units('123.456789012345678901')), '123.456789012345678901');
  assert.equal(decimal(0n), '0.000000000000000000');
});

test('native amount parser rejects precision loss, exponent notation and negative amounts', () => {
  for (const value of ['0.0000000000000000001', '-1', '+1', '1e-8', '01', '.1', '1.', ' 1', 'NaN']) assert.throws(() => units(value), undefined, value);
  assert.throws(() => decimal(-1n));
});

test('a MON quote charges its amount per million units, with full sub-micro precision', () => {
  const rates = quote({ output: '0.0000008' });
  assert.equal(fee(rates, { input: 0, cacheRead: 0, cacheWrite: 0, output: 1 }), 800_000n);
  assert.equal(fee(rates, { input: 0, cacheRead: 0, cacheWrite: 0, output: 1_000_000 }), units('0.0000008'));
  assert.equal(fee(quote({ input: '1', cacheRead: '0.5', cacheWrite: '1.25', output: '2' }), { input: 1, cacheRead: 1, cacheWrite: 1, output: 1 }), 4_750_000_000_000n);
});

test('fees round up once across buckets to a single wei, including all remainder carry', () => {
  const oneWei = '0.000000000000000001'; const rates = quote({ input: oneWei, cacheRead: oneWei, cacheWrite: oneWei, output: oneWei });
  assert.equal(fee(rates, { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }), 0n);
  assert.equal(fee(rates, { input: 1, cacheRead: 1, cacheWrite: 1, output: 1 }), 1n);
  assert.equal(fee(rates, { input: 250_000, cacheRead: 250_000, cacheWrite: 250_000, output: 250_000 }), 1n);
  assert.equal(fee(rates, { input: 250_001, cacheRead: 250_000, cacheWrite: 250_000, output: 250_000 }), 2n);
  assert.equal(fee(rates, { input: 999_999, cacheRead: 999_999, cacheWrite: 999_999, output: 999_999 }), 4n);
});

test('fee arithmetic stays bigint beyond floating point precision and rejects invalid usage', () => {
  const rate = '12345678901234567890.123456789012345678';
  assert.equal(fee(quote({ output: rate }), { input: 0, cacheRead: 0, cacheWrite: 0, output: 1_000_000 }), units(rate));
  for (const output of [-1, 0.1, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) assert.throws(() => fee(quote({ output: '1' }), { input: 0, cacheRead: 0, cacheWrite: 0, output }));
});
