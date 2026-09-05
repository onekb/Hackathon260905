import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MockEngine, mockAnswer, type MockEvent, type MockMode, type MockRequest } from '../src/mock-engine.js';

const request = (id = 'request-1', maxTokens = 80): MockRequest => ({
  requestId: id, buyer: 'buyer-1', model: 'mock-reasoner',
  messages: [{ role: 'user', content: '你好 👩🏽‍💻' }], maxTokens,
  cache: 'none', usage: { input: 12, cacheRead: 0, cacheWrite: 0, output: 0 },
});

async function run(mode: MockMode, maxTokens = 80): Promise<{ engine: MockEngine; events: MockEvent[] }> {
  const events: MockEvent[] = [];
  let complete!: () => void;
  const done = new Promise<void>((resolve) => { complete = resolve; });
  const engine = new MockEngine({ capacity: 1, intervalMs: 1, chunkSize: 4, emit: (event) => {
    events.push(event);
    if (['completed', 'failed', 'cancelled'].includes(event.type)) complete();
  } });
  assert.equal(engine.start(request('request-1', maxTokens), mode), 'started');
  await done;
  return { engine, events };
}

test('normal output has consecutive sequence numbers and exact Unicode-unit maxTokens', async () => {
  const { engine, events } = await run('normal', 37);
  const chunks = events.filter((event) => event.type === 'chunk');
  assert.deepEqual(chunks.map((event) => event.seq), chunks.map((_, index) => index));
  assert.equal(chunks.reduce((count, event) => count + event.outputTokens, 0), 37);
  assert.equal(Array.from(chunks.map((event) => event.text).join('')).length, 37);
  assert.deepEqual(events.at(-1), { type: 'completed', requestId: 'request-1', seq: chunks.length });
  assert.equal(engine.activeCount, 0);
  assert.equal(engine.snapshots()[0]?.status, 'completed');
});

test('seller fail-before emits no chunks, fail-mid emits partial output then exactly one failure', async () => {
  const before = await run('fail-before');
  assert.equal(before.events.filter((event) => event.type === 'chunk').length, 0);
  assert.equal(before.events.at(-1)?.type, 'failed');
  const middle = await run('fail-mid');
  const output = middle.events.filter((event) => event.type === 'chunk').reduce((sum, event) => sum + event.outputTokens, 0);
  assert.ok(output > 0 && output < 80);
  assert.equal(middle.events.filter((event) => event.type === 'failed').length, 1);
  assert.equal(middle.events.filter((event) => event.type === 'completed').length, 0);
});

test('cancel stops immediately after accepted chunk and does not finish or emit later chunks', async () => {
  const events: MockEvent[] = [];
  const engine = new MockEngine({ capacity: 1, intervalMs: 1, chunkSize: 4, emit: (event) => {
    events.push(event);
    if (event.type === 'chunk') engine.cancel(event.requestId);
  } });
  engine.start(request(), 'normal');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(events.map((event) => event.type), ['started', 'chunk', 'cancelled']);
  assert.equal(engine.cancel('request-1'), false);
  assert.equal(engine.activeCount, 0);
  assert.equal(engine.snapshots()[0]?.usage.output, 4);
});

test('timeout holds capacity until cancel; repeated request IDs never restart output', async () => {
  const events: MockEvent[] = [];
  const engine = new MockEngine({ capacity: 1, intervalMs: 1, chunkSize: 4, emit: (event) => events.push(event) });
  assert.equal(engine.start(request(), 'timeout'), 'started');
  assert.equal(engine.availableSlots, 0);
  assert.equal(engine.start(request(), 'normal'), 'duplicate');
  assert.equal(engine.start(request('another'), 'normal'), 'busy');
  assert.equal(engine.cancel('request-1'), true);
  assert.equal(engine.start(request(), 'normal'), 'duplicate');
  assert.equal(engine.availableSlots, 1);
  assert.deepEqual(events.map((event) => event.type), ['started', 'cancelled']);
});

test('disconnect aborts every active run without replay or terminal network events', async () => {
  const events: MockEvent[] = [];
  const engine = new MockEngine({ capacity: 2, intervalMs: 15, chunkSize: 4, emit: (event) => events.push(event) });
  engine.start(request('a'), 'normal');
  engine.start(request('b'), 'timeout');
  engine.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(events.map((event) => event.type), ['started', 'started']);
  assert.equal(engine.activeCount, 0);
  assert.ok(engine.snapshots().every((entry) => entry.status === 'disconnected'));
  assert.equal(engine.start(request('a'), 'normal'), 'duplicate');
});

test('cache explanation follows router request classification instead of claiming first-hit cache', () => {
  const write = { ...request(), cache: 'write' as const };
  const read = { ...request(), cache: 'read' as const };
  assert.match(mockAnswer(write), /模拟写入缓存/);
  assert.match(mockAnswer(read), /平台确认命中/);
  assert.match(mockAnswer(request()), /未使用模拟缓存/);
});

test('mode is captured per request; recent snapshots do not expose prompt text', async () => {
  const { engine } = await run('normal');
  const snapshot = JSON.stringify(engine.snapshots());
  assert.doesNotMatch(snapshot, /你好/);
  const first = engine.snapshots()[0]!;
  first.usage.input = 100000;
  assert.equal(engine.snapshots()[0]!.usage.input, 12);
});
