import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
export interface StoredCredential { hash: string; wallet: string; type: 'session' | 'api-key'; name: string; preview: string; createdAt: number; expiresAt: number; revokedAt?: number }
export interface MarketIdentity { market_address: string; asset_symbol: string; asset_decimals: number }
export const sameMarket = (a: MarketIdentity, b: MarketIdentity) => typeof a.market_address === 'string' && typeof b.market_address === 'string' && a.market_address.toLowerCase() === b.market_address.toLowerCase() && a.asset_symbol === b.asset_symbol && a.asset_decimals === b.asset_decimals;
export interface State { version: 1; market?: MarketIdentity; orders: Record<string, any>; idempotency: Record<string, { id: string; fingerprint: string }>; credentials: Record<string, StoredCredential>; cache: Record<string, number> }
export class Store {
  state: State = {version:1,orders:{},idempotency:{},credentials:{},cache:{}};
  constructor(private path?: string) {
    if (path) { try { this.state = JSON.parse(readFileSync(path, 'utf8')); if (this.state.version !== 1) throw new Error('Unsupported store version'); } catch (e: any) { if (e.code !== 'ENOENT') throw e; } }
  }
  /** Bind the ledger before any recovery can sign. Legacy orders stay in their original asset. */
  bindMarket(current: MarketIdentity, legacy?: MarketIdentity): void {
    const orders = Object.values(this.state.orders);
    const previous = this.state.market;
    if (previous && !sameMarket(previous, current) && (!legacy || !sameMarket(previous, legacy))) throw new Error('Ledger belongs to a different market; explicit legacy configuration is required');
    const source = previous ?? (orders.length ? legacy : current);
    if (!source) throw new Error('Unbound ledger contains orders; supply the original legacy market before migrating');
    // Validate the entire migration first, so a rejected migration cannot partially relabel data.
    const identities = orders.map(order => {
      const hasIdentity = ['market_address', 'asset_symbol', 'asset_decimals'].some(key => order[key] !== undefined);
      const identity = hasIdentity ? order as MarketIdentity : source;
      if (!sameMarket(identity, current) && (!legacy || !sameMarket(identity, legacy))) throw new Error('Order has an unknown or inconsistent asset identity');
      if (!sameMarket(identity, current) && (['locking', 'running', 'reservation_unknown'].includes(order.status) || order.reservationUncertain || order.settlement === 'pending' || (order.settlement === 'failed' && order.status !== 'lock_failed'))) throw new Error('Resolve outstanding legacy reservations before switching the market');
      return identity;
    });
    orders.forEach((order, index) => Object.assign(order, identities[index]));
    if (!previous || !sameMarket(previous, current)) this.state.cache = {};
    this.state.market = {...current};
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
