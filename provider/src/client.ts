import WebSocket from 'ws';
import { ProviderSigningError, type ProviderAccount } from './signer.js';
import { MockEngine, MODES, type MockMode, type MockRequest } from './mock-engine.js';
import { validatePricing, type Pricing, type ProviderConfig } from './config.js';

export type NodeStatus = 'offline' | 'connecting' | 'authenticating' | 'online' | 'reconnecting';

function parseRequest(message: Record<string, unknown>): MockRequest {
  if (typeof message.requestId !== 'string' || message.requestId.length > 128 || typeof message.buyer !== 'string' || typeof message.model !== 'string') throw new Error('派单身份字段无效');
  if (!Array.isArray(message.messages) || message.messages.length > 100 || message.messages.some((entry) => !entry || typeof entry.role !== 'string' || typeof entry.content !== 'string')) throw new Error('仅支持文本 messages');
  if (!Number.isSafeInteger(message.maxTokens) || Number(message.maxTokens) < 1 || Number(message.maxTokens) > 10000) throw new Error('maxTokens 必须在 1–10000 之间');
  if (!['none', 'read', 'write'].includes(String(message.cache))) throw new Error('缓存模式无效');
  const usage = message.usage as Record<string, unknown> | undefined;
  if (!usage || ['input', 'cacheRead', 'cacheWrite', 'output'].some((key) => !Number.isSafeInteger(usage[key]) || Number(usage[key]) < 0)) throw new Error('模拟用量无效');
  return message as unknown as MockRequest;
}

export class ProviderClient {
  readonly engine: MockEngine;
  private socket?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private authDeadline?: ReturnType<typeof setTimeout>;
  private enabled = false;
  private state: NodeStatus = 'offline';
  private lastError: string | null = null;
  private rejectedReason: string | null = null;
  private retries = 0;
  private mode: MockMode;
  private pricing: Pricing;
  private effectivePricing: (Pricing & { version?: string }) | null = null;
  private effectivePricingVerifiedAt: string | null = null;
  private readonly challenges = new Set<string>();

  constructor(readonly config: ProviderConfig, readonly account: ProviderAccount) {
    this.mode = config.mode;
    this.pricing = { ...config.pricing };
    this.engine = new MockEngine({
      capacity: config.capacity,
      intervalMs: config.intervalMs,
      chunkSize: config.chunkSize,
      emit: (event) => this.send(event),
      changed: () => this.sendHeartbeat(),
    });
  }

  snapshot() {
    return {
      providerId: this.config.id, name: this.config.name, modelId: this.config.modelId,
      wallet: this.account.address, router: this.config.router, status: this.state,
      enabled: this.enabled, mode: this.mode, pricing: { ...this.pricing },
      effectivePricing: this.effectivePricing ? { ...this.effectivePricing } : null,
      effectivePricingVerifiedAt: this.effectivePricingVerifiedAt,
      pricingMatchesEffective: this.effectivePricing !== null && Object.keys(this.pricing).every((key) => {
        const normalize = (value: string) => {
          const [whole, fraction = ''] = value.split('.');
          return BigInt(whole!) * 1000000n + BigInt(fraction.padEnd(6, '0'));
        };
        return normalize(this.pricing[key as keyof Pricing]) === normalize(this.effectivePricing![key as keyof Pricing]);
      }),
      capacity: this.config.capacity, active: this.engine.activeCount,
      availableSlots: this.engine.availableSlots, intervalMs: this.config.intervalMs,
      chunkSize: this.config.chunkSize, lastError: this.lastError,
      rejectedReason: this.rejectedReason,
      mock: true, ephemeralWallet: this.config.ephemeral,
      walletMode: this.config.alchemySession ? 'alchemy-session' : this.config.ephemeral ? 'ephemeral' : 'private-key',
      requests: this.engine.snapshots(),
    };
  }

  online(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.lastError = null;
    this.rejectedReason = null;
    this.connect();
  }

  offline(): void {
    this.enabled = false;
    clearTimeout(this.retry);
    this.retry = undefined;
    this.clearTimers();
    this.engine.disconnect();
    this.state = 'offline';
    this.lastError = null;
    this.rejectedReason = null;
    this.socket?.close(1000, 'Provider offline');
    this.socket = undefined;
  }

  setMode(value: unknown): void {
    if (!MODES.includes(value as MockMode)) throw new Error('不支持的故障模式');
    this.mode = value as MockMode;
    this.sendHeartbeat();
  }

  setPricing(value: unknown): void {
    const pricing = validatePricing(value);
    if (this.engine.activeCount !== 0) throw new Error('请等待当前订单结束，再更新报价');
    const wasEnabled = this.enabled;
    this.offline();
    this.pricing = pricing;
    if (wasEnabled) this.online();
  }

  private send(data: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(data));
  }

  private sendHeartbeat(): void {
    if (this.state === 'online') this.send({ type: 'heartbeat', availableSlots: this.engine.availableSlots, mode: this.mode });
  }

  private clearTimers(): void {
    clearInterval(this.heartbeat);
    clearTimeout(this.authDeadline);
    this.heartbeat = undefined;
    this.authDeadline = undefined;
  }

  private connect(): void {
    if (!this.enabled) return;
    this.state = this.retries ? 'reconnecting' : 'connecting';
    const socket = new WebSocket(this.config.router, { maxPayload: 1_048_576, handshakeTimeout: 10000 });
    this.socket = socket;
    this.authDeadline = setTimeout(() => {
      if (this.socket === socket && this.state !== 'online') {
        this.lastError = '身份认证超时，正在重连';
        socket.terminate();
      }
    }, 15000);
    socket.on('open', () => { if (this.socket === socket) this.state = 'authenticating'; });
    socket.on('message', (raw, isBinary) => {
      if (this.socket !== socket || isBinary) return;
      let message: Record<string, unknown>;
      try { message = JSON.parse(raw.toString()); } catch { this.lastError = '平台返回无效 JSON'; socket.close(1003); return; }
      void this.handle(message, socket).catch((error) => {
        this.lastError = error instanceof ProviderSigningError ? error.message : '平台协议或身份挑战无效';
        if (error instanceof ProviderSigningError) this.rejectedReason = error.message;
        socket.close(1008, 'Invalid provider protocol');
      });
    });
    socket.on('error', () => { if (this.socket === socket && !this.rejectedReason) this.lastError = '无法连接平台；请检查 Router 地址和服务状态'; });
    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.clearTimers();
      this.socket = undefined;
      this.engine.disconnect();
      if (!this.enabled) { this.state = 'offline'; return; }
      this.state = 'reconnecting';
      const backoff = Math.min(15000, 1000 * 2 ** Math.min(this.retries++, 4));
      this.retry = setTimeout(() => this.connect(), backoff);
    });
  }

  private async handle(message: Record<string, unknown>, socket: WebSocket): Promise<void> {
    if (message.type === 'challenge') {
      if (this.state !== 'authenticating') throw new Error('Unexpected challenge');
      const nonce = message.nonce;
      const text = message.message;
      const expires = typeof message.expiresAt === 'number' ? message.expiresAt : Date.parse(String(message.expiresAt));
      const routerHost = new URL(this.config.router).host;
      if (typeof nonce !== 'string' || nonce.length < 16 || typeof text !== 'string' || text.length > 4096 || !text.includes(nonce) || !text.includes(routerHost) || !text.toLowerCase().includes('provider') || !Number.isFinite(expires) || expires <= Date.now() || expires > Date.now() + 600000 || this.challenges.has(nonce)) throw new Error('Invalid authentication challenge');
      this.challenges.add(nonce);
      if (this.challenges.size > 128) this.challenges.delete(this.challenges.values().next().value!);
      const signature = await this.account.signMessage({ message: text });
      if (this.socket !== socket || !this.enabled || socket.readyState !== WebSocket.OPEN) return;
      this.send({
        type: 'auth', address: this.account.address, signature, mock: true,
        provider: {
          id: this.config.id, name: this.config.name, modelId: this.config.modelId,
          capacity: this.config.capacity, pricing: this.pricing, mode: this.mode,
        },
      });
      return;
    }
    if (message.type === 'authenticated') {
      if (this.state !== 'authenticating') throw new Error('Unexpected authentication');
      if (message.quote !== undefined) {
        const quote = validatePricing(message.quote);
        const version = (message.quote as Record<string, unknown>).version;
        this.effectivePricing = { ...quote, ...(typeof version === 'string' ? { version: version.slice(0, 64) } : {}) };
        this.effectivePricingVerifiedAt = new Date().toISOString();
      } else {
        this.effectivePricing = null;
        this.effectivePricingVerifiedAt = null;
      }
      clearTimeout(this.authDeadline);
      this.state = 'online';
      this.retries = 0;
      this.lastError = null;
      this.rejectedReason = null;
      this.sendHeartbeat();
      this.heartbeat = setInterval(() => this.sendHeartbeat(), 5000);
      return;
    }
    if (message.type === 'ping') { this.send({ type: 'pong' }); return; }
    if (message.type === 'rejected') {
      this.rejectedReason = typeof message.message === 'string' ? message.message.slice(0, 300) : '平台拒绝节点接入';
      this.lastError = `平台拒绝连接：${this.rejectedReason}`;
      socket.close(1008, 'Provider rejected');
      return;
    }
    if (message.type === 'error') {
      this.lastError = typeof message.message === 'string' ? message.message.slice(0, 240) : '平台返回错误';
      return;
    }
    if (this.state !== 'online') throw new Error('Not authenticated');
    if (message.type === 'cancel') {
      if (typeof message.requestId === 'string') this.engine.cancel(message.requestId);
      return;
    }
    if (message.type === 'request') {
      const request = parseRequest(message);
      if (request.model !== this.config.modelId) {
        this.send({ type: 'failed', requestId: request.requestId, seq: 0, message: '卖家未提供该模拟模型' });
        return;
      }
      const result = this.engine.start(request, this.mode);
      if (result === 'busy') this.send({ type: 'failed', requestId: request.requestId, seq: 0, message: '卖家并发容量已满' });
      // Duplicate dispatch IDs are ignored. Replaying output would duplicate metering.
    }
  }
}
