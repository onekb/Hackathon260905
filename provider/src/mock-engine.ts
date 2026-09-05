/** All counts in this module are simulated Unicode-codepoint units, never model tokens. */
export const MODES = ['normal', 'timeout', 'fail-before', 'fail-mid', 'cache-hit'] as const;
export type MockMode = typeof MODES[number];
export type Usage = { input: number; cacheRead: number; cacheWrite: number; output: number };
export type MockRequest = {
  requestId: string;
  buyer: string;
  model: string;
  messages: { role: string; content: string }[];
  maxTokens: number;
  cache: 'none' | 'read' | 'write';
  usage: Usage;
};
export type MockEvent =
  | { type: 'started'; requestId: string }
  | { type: 'chunk'; requestId: string; seq: number; text: string; outputTokens: number }
  | { type: 'completed'; requestId: string; seq: number }
  | { type: 'failed'; requestId: string; seq: number; message: string }
  | { type: 'cancelled'; requestId: string; seq: number };

export type RunSummary = {
  requestId: string;
  mode: MockMode;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'disconnected';
  startedAt: string;
  endedAt?: string;
  outputTokens: number;
  cache: MockRequest['cache'];
  usage: Usage;
};

type ActiveRun = {
  summary: RunSummary;
  seq: number;
  stopped: boolean;
  abort: AbortController;
};

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

export function mockAnswer(request: MockRequest): string {
  const last = request.messages.findLast((message) => message.role === 'user')?.content ?? '';
  const preview = Array.from(last).slice(0, 80).join('');
  const cache = request.cache === 'read'
    ? '本次由平台确认命中相同买家、卖家、模型和上下文的缓存。'
    : request.cache === 'write'
      ? '本次写入缓存，成功完成后可用相同上下文再次请求。'
      : '本次未使用缓存。';
  return `【AI 推理演示】\n已收到：${preview || '空白演示请求'}\n\n这是独立卖家节点生成的固定演示响应，没有调用真实 AI 模型。\n${cache}\n\n平台将按 Unicode 字符单位记录用量、执行预算控制，并记录本次账单。卖家故障整单推理费为零；买家主动取消按已计量用量结算。\n\n你可以在卖家本地控制台切换故障模式，再发起新请求观察不同结算结果。`;
}

export class MockEngine {
  private readonly active = new Map<string, ActiveRun>();
  private readonly seen = new Set<string>();
  private readonly history: RunSummary[] = [];

  constructor(private readonly options: {
    capacity: number;
    intervalMs: number;
    chunkSize: number;
    emit: (event: MockEvent) => void;
    changed?: () => void;
  }) {}

  get activeCount(): number { return this.active.size; }
  get availableSlots(): number { return Math.max(0, this.options.capacity - this.active.size); }
  snapshots(): RunSummary[] { return this.history.map((run) => ({ ...run, usage: { ...run.usage } })); }

  /** Duplicate IDs never restart inference, including after completion. */
  start(request: MockRequest, mode: MockMode): 'started' | 'duplicate' | 'busy' {
    if (this.seen.has(request.requestId)) return 'duplicate';
    if (this.availableSlots === 0) return 'busy';
    this.seen.add(request.requestId);
    // Bounded history: keep active IDs, discard the oldest completed replay entries only.
    if (this.seen.size > 4096) {
      for (const id of this.seen) {
        if (!this.active.has(id) && id !== request.requestId) { this.seen.delete(id); break; }
      }
    }
    const summary: RunSummary = {
      requestId: request.requestId,
      mode,
      status: 'running',
      startedAt: new Date().toISOString(),
      outputTokens: 0,
      cache: request.cache,
      usage: { ...request.usage },
    };
    const run: ActiveRun = { summary, seq: 0, stopped: false, abort: new AbortController() };
    this.active.set(request.requestId, run);
    this.history.unshift(summary);
    if (this.history.length > 100) this.history.pop();
    this.options.changed?.();
    void this.execute(request, run);
    return 'started';
  }

  cancel(requestId: string): boolean {
    const run = this.active.get(requestId);
    if (!run) return false;
    this.finish(run, 'cancelled');
    this.options.emit({ type: 'cancelled', requestId, seq: run.seq });
    return true;
  }

  /** A broken connection is final locally. Nothing is replayed on reconnect. */
  disconnect(): void {
    for (const run of Array.from(this.active.values())) this.finish(run, 'disconnected');
  }

  private finish(run: ActiveRun, status: RunSummary['status']): void {
    if (run.stopped) return;
    run.stopped = true;
    run.abort.abort();
    run.summary.status = status;
    run.summary.endedAt = new Date().toISOString();
    this.active.delete(run.summary.requestId);
    this.options.changed?.();
  }

  private async execute(request: MockRequest, run: ActiveRun): Promise<void> {
    const { requestId } = request;
    try {
      this.options.emit({ type: 'started', requestId });
      if (run.summary.mode === 'timeout') return; // Router deadline/cancel closes this run.
      if (run.summary.mode === 'fail-before') {
        await delay(this.options.intervalMs, run.abort.signal);
        if (run.stopped) return;
        this.finish(run, 'failed');
        this.options.emit({ type: 'failed', requestId, seq: run.seq, message: '卖家故障：首个输出前失败' });
        return;
      }
      const units = Array.from(mockAnswer(request)).slice(0, Math.max(0, Math.min(10000, request.maxTokens)));
      const failAfter = Math.max(1, Math.min(48, Math.ceil(units.length / 3)));
      for (let offset = 0; offset < units.length; offset += this.options.chunkSize) {
        await delay(this.options.intervalMs, run.abort.signal);
        if (run.stopped) return;
        const chunk = units.slice(offset, offset + this.options.chunkSize);
        run.summary.outputTokens += chunk.length;
        run.summary.usage.output = run.summary.outputTokens;
        this.options.emit({ type: 'chunk', requestId, seq: run.seq++, text: chunk.join(''), outputTokens: chunk.length });
        this.options.changed?.();
        // An emit callback may synchronously cancel a budget-limited request.
        if (run.stopped) return;
        if (run.summary.mode === 'fail-mid' && run.summary.outputTokens >= failAfter) {
          this.finish(run, 'failed');
          this.options.emit({ type: 'failed', requestId, seq: run.seq, message: '卖家故障：输出过程中断' });
          return;
        }
      }
      if (run.stopped) return;
      this.finish(run, 'completed');
      this.options.emit({ type: 'completed', requestId, seq: run.seq });
    } catch {
      if (run.stopped) return;
      this.finish(run, 'failed');
      this.options.emit({ type: 'failed', requestId, seq: run.seq, message: '节点执行错误' });
    }
  }
}
