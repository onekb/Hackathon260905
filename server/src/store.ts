import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
export interface StoredCredential { hash: string; wallet: string; type: 'session' | 'api-key'; name: string; preview: string; createdAt: number; expiresAt: number; revokedAt?: number; market_address?: string }
export interface MarketIdentity { market_address: string; asset_symbol: string; asset_decimals: number }
export const sameMarket = (a: MarketIdentity, b: MarketIdentity) => typeof a.market_address === 'string' && typeof b.market_address === 'string' && a.market_address.toLowerCase() === b.market_address.toLowerCase() && a.asset_symbol === b.asset_symbol && a.asset_decimals === b.asset_decimals;
export interface State { version: 1; admissionHistory?: { buyer: string; createdAt: number }[]; market?: MarketIdentity; orders: Record<string, any>; idempotency: Record<string, { id: string; fingerprint: string }>; credentials: Record<string, StoredCredential>; cache: Record<string, number> }
export class Store {
  state: State = {version:1,orders:{},idempotency:{},credentials:{},cache:{}};
  constructor(private path?: string) {
    if (path) { try { this.state = JSON.parse(readFileSync(path, 'utf8')); if (this.state.version !== 1) throw new Error('Unsupported store version'); } catch (e: any) { if (e.code !== 'ENOENT') throw e; } }
  }
  /** Native ledgers must explicitly match the deployed market before recovery can sign. */
  bindMarket(current: MarketIdentity): void {
    const orders = Object.values(this.state.orders);
    const keys = Object.values(this.state.credentials).filter(c => c.type === 'api-key');
    if (!this.state.market && (orders.length || keys.length)) throw new Error('Unbound nonempty ledger cannot be used as a native MON ledger');
    if (this.state.market && !sameMarket(this.state.market, current)) throw new Error('Ledger belongs to a different market');
    if (orders.some(order => !sameMarket(order, current))) throw new Error('Order asset identity does not match the native market');
    if (keys.some(key => key.market_address?.toLowerCase() !== current.market_address.toLowerCase())) throw new Error('API key belongs to a different market');
    const history = this.state.admissionHistory ?? [];
    if (!Array.isArray(history) || history.some(item => !/^0x[0-9a-fA-F]{40}$/.test(item.buyer) || !Number.isSafeInteger(item.createdAt) || item.createdAt <= 0)) throw new Error('Invalid admission history');
    this.state.market = {...current};
    this.state.admissionHistory = history;
    this.save();
  }
  save(): void {
    if (!this.path) return;
    mkdirSync(dirname(this.path), {recursive: true, mode:0o700});
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state), {mode:0o600});
    renameSync(tmp, this.path);
  }
}
