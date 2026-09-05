import { decimal, fee, units, type Quote, type Usage } from './money.js';
export type { Quote, Usage } from './money.js';
export type Outcome = 0 | 1 | 2 | 3 | 4;
export interface ChainAccount { available: string; authorized: string; authorizationExpiresAt: number }
export interface ChainOrder { state: 'unknown' | 'locked' | 'settled' | 'refunded'; charge?: string; txHash?: string }
export interface LockInput { id: string; buyer: string; seller: string; model: string; budget: string; quote: Quote; deadline: number }
export interface SettleInput { id: string; usage: Usage; outcome: Outcome; charge: string }
export interface ChainAdapter {
  mode: 'memory' | 'anvil' | 'monad-testnet';
  readonly market?: string;
  getAccount(wallet: string): Promise<ChainAccount>;
  getQuote(wallet: string, model: string): Promise<Quote | null>;
  lock(input: LockInput): Promise<{ txHash: string }>;
  settle(input: SettleInput): Promise<{ txHash: string }>;
  getOrder(id: string): Promise<ChainOrder>;
}
/** Explicit local test adapter. Never represents a real blockchain or real transaction. */
export class MemoryChain implements ChainAdapter {
  mode = 'memory' as const;
  accounts = new Map<string, { balance: bigint; allowance: bigint; expiresAt: number }>();
  quotes = new Map<string, Quote>();
  orders = new Map<string, LockInput & { state: 'locked' | 'settled'; charge: string; txHash: string }>();
  constructor() {}
  fund(wallet: string, amount = '100', allowance = amount): void {
    this.accounts.set(wallet.toLowerCase(), {balance: units(amount), allowance: units(allowance), expiresAt: Math.floor(Date.now() / 1000) + 86400});
  }
  quote(wallet: string, model: string, quote: Quote): void { this.quotes.set(`${wallet.toLowerCase()}:${model}`, {...quote}); }
  async getAccount(wallet: string): Promise<ChainAccount> {
    const a = this.accounts.get(wallet.toLowerCase());
    return { available: decimal(a?.balance ?? 0n), authorized: decimal(a && a.expiresAt > Date.now()/1000 ? a.allowance : 0n), authorizationExpiresAt: a?.expiresAt ?? 0 };
  }
  async getQuote(wallet: string, model: string): Promise<Quote | null> { return this.quotes.get(`${wallet.toLowerCase()}:${model}`) ?? null; }
  async lock(input: LockInput): Promise<{ txHash: string }> {
    const existing = this.orders.get(input.id);
    if (existing) return {txHash: existing.txHash};
    const a = this.accounts.get(input.buyer.toLowerCase());
    const budget = units(input.budget);
    if (!a || a.balance < budget || a.allowance < budget || a.expiresAt <= Date.now()/1000) throw new Error('Insufficient available balance or active authorization');
    a.balance -= budget; a.allowance -= budget;
    const txHash = `memory:lock:${input.id}`;
    this.orders.set(input.id, {...input, state: 'locked', charge: decimal(0n), txHash});
    return {txHash};
  }
  async settle(input: SettleInput): Promise<{ txHash: string }> {
    const o = this.orders.get(input.id);
    if (!o) throw new Error('Unknown chain order');
    if (o.state === 'settled') return {txHash:o.txHash};
    const charge = input.outcome >= 3 ? 0n : fee(o.quote, input.usage);
    if (charge !== units(input.charge) || charge > units(o.budget)) throw new Error('Settlement fee mismatch or over budget');
    const a = this.accounts.get(o.buyer.toLowerCase())!;
    a.balance += units(o.budget) - charge; a.allowance += units(o.budget) - charge;
    o.state = 'settled'; o.charge = decimal(charge); o.txHash = `memory:settle:${input.id}`;
    return {txHash: o.txHash};
  }
  async getOrder(id: string): Promise<ChainOrder> {
    const o = this.orders.get(id); return o ? {state:o.state, charge:o.charge, txHash:o.txHash} : {state:'unknown'};
  }
}
