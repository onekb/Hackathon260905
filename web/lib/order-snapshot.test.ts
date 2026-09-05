import test from 'node:test';
import assert from 'node:assert/strict';
import { newerSnapshot, type OrderSnapshot } from './order-snapshot';

function snapshot(overrides: Partial<OrderSnapshot> = {}): OrderSnapshot {
  const output = overrides.output ?? '第一段';
  return {
    id: 'same-request', buyer: 'buyer', seller: 'seller', providerId: 'provider', model: 'mock-reasoner',
    asset_symbol: 'MON', asset_decimals: 18, market_address: '0x0000000000000000000000000000000000001234',
    budget: '0.001', quote: { input: '0.3', cacheRead: '0.03', cacheWrite: '0.375', output: '0.8', minReserve: '0.000001' },
    usage: { input: 5, cacheRead: 0, cacheWrite: 0, output: Array.from(output).length },
    maxTokens: 100, output, status: 'running', settlement: 'unsubmitted', billConfirmed: false,
    charge: '0', released: '0.001', createdAt: 100, deadline: 400, cacheMode: 'none', updatedAt: 200,
    ...overrides,
  };
}

test('each partial snapshot becomes visible before execution finishes', () => {
  let current: OrderSnapshot | undefined;
  for (const [index, output] of ['第', '第一段', '第一段🙂'].entries()) {
    const incoming = snapshot({ output, updatedAt: 200 + index });
    current = newerSnapshot(current, incoming);
    assert.equal(current, incoming);
    assert.equal(current.output, output);
    assert.equal(current.status, 'running');
  }
});

test('late polling cannot shorten newer SSE output even when timestamps tie or are missing', () => {
  for (const updatedAt of [200, undefined]) {
    const streamed = snapshot({ output: '第一段第二段🙂', updatedAt });
    const earlierPoll = snapshot({ output: '第一段', updatedAt });
    assert.equal(newerSnapshot(streamed, earlierPoll), streamed);
  }
});

test('a same-millisecond locking snapshot cannot replace running before the first token', () => {
  const running = snapshot({ output: '' });
  assert.equal(newerSnapshot(running, snapshot({ status: 'locking', output: '' })), running);
});

test('older timestamps and stale running events cannot roll back confirmed bills', () => {
  const streamed = snapshot({ output: '第一段第二段', updatedAt: 300 });
  assert.equal(newerSnapshot(streamed, snapshot({ updatedAt: 200 })), streamed);
  const confirmed = snapshot({ output: streamed.output, status: 'completed', billConfirmed: true, settlement: 'confirmed', updatedAt: 400 });
  assert.equal(newerSnapshot(confirmed, snapshot({ updatedAt: 500 })), confirmed);
});

test('same-output completion and later settlement confirmation still advance the bill', () => {
  const running = snapshot();
  const completed = snapshot({ status: 'completed', settlement: 'pending' });
  const confirmed = snapshot({ status: 'completed', settlement: 'confirmed', billConfirmed: true, charge: '0.000004', released: '0.000996' });
  assert.equal(newerSnapshot(running, completed), completed);
  assert.equal(newerSnapshot(completed, confirmed), confirmed);
});
