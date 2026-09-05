import type { Address, Hex } from 'viem';

export type PriceKey = 'input' | 'cacheRead' | 'cacheWrite' | 'output';
export type Quote = Record<PriceKey, string> & { minReserve: string; version?: string };
export interface MarketConfig { chain_id: number; chain_mode: string; market_address: Address; token_address: Address; mock_inference: boolean }
export interface WalletAccess {
  address?: Address;
  connect: () => void;
  signMessage: (message: string) => Promise<Hex>;
  sendContract: (target: 'market' | 'token', functionName: string, args?: readonly unknown[]) => Promise<Hex>;
}
export interface AccountInfo { wallet: string; available: string; authorized: string; authorizationExpiresAt: number; chain_mode: string }
export interface Seller { id: string; provider_id: string; provider_name: string; seller: string; quote: Quote; online: boolean; available_slots: number; mode: string }
export interface Order {
  id: string; buyer: string; providerId: string; seller: string; model: string; budget: string; quote: Quote;
  usage: Record<PriceKey, number>; maxTokens: number; output: string; status: string;
  settlement: string; billConfirmed: boolean; reason?: string; charge: string; released: string;
  lockTx?: string; settlementTx?: string; settlementError?: string; deadline: number; createdAt: number; cacheMode: string;
}
