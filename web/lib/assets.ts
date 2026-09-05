import { getAddress, isAddress, parseUnits, zeroAddress, type Address } from 'viem';
import type { ContractTarget, MarketConfig, Order } from './types';

export const LEGACY_MARKET: Address = '0x6F1b725DD3588cb5c8C3f72F614E80ebB2d82568';
export const LEGACY_TOKEN: Address = '0x62701D69bD213e8F63c28465528931de208cE06E';

export function parseAmount(value: string, decimals: 18 | 6, label: string, allowZero = false): bigint {
  const text = value.trim();
  if (!new RegExp(`^(0|[1-9]\\d*)(\\.\\d{1,${decimals}})?$`).test(text)) throw new Error(`${label}请输入非负十进制金额，最多 ${decimals} 位小数。`);
  const units = parseUnits(text, decimals);
  if ((!allowZero && units === 0n) || units > 2n ** 256n - 1n) throw new Error(`${label}必须${allowZero ? '不小于' : '大于'} 0，且在合约支持的范围内。`);
  return units;
}

/** Decimal strings stay exact; never coerce wei-denominated amounts to Number. */
export function formatAmount(value: string | number = '0'): string {
  const text = String(value);
  if (!/^\d+(\.\d+)?$/.test(text)) return '—';
  const [integer, fraction = ''] = text.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (trimmed ? `.${trimmed}` : '');
}

export function validateMarketConfig(config: MarketConfig, expectedMarket?: Address): MarketConfig {
  if (![10143, 31337].includes(config.chain_id) || config.asset_symbol !== 'MON' || config.asset_decimals !== 18
    || !isAddress(config.market_address) || config.market_address === zeroAddress || config.market_address.toLowerCase() === LEGACY_MARKET.toLowerCase()) throw new Error('平台尚未提供有效的原生 MON 市场配置。');
  if (config.chain_id === 10143 && expectedMarket === zeroAddress) throw new Error('此版本前端尚未绑定已验证的原生 MON 合约。');
  if (config.chain_id === 10143 && expectedMarket && config.market_address.toLowerCase() !== expectedMarket.toLowerCase()) throw new Error('平台市场合约与此版本前端不一致。');
  if (config.chain_id === 10143 && (config.legacy_market_address?.toLowerCase() !== LEGACY_MARKET.toLowerCase()
    || config.legacy_token_address?.toLowerCase() !== LEGACY_TOKEN.toLowerCase() || config.legacy_asset_symbol !== 'dUSD')) throw new Error('旧 dUSD 资产配置不完整或与已知部署不一致。');
  return config;
}

export function orderAsset(order: Pick<Order, 'asset_symbol' | 'asset_decimals' | 'market_address'>, config: MarketConfig): { symbol: string; target?: ContractTarget; market?: Address } {
  const market = order.market_address;
  const validMarket = typeof market === 'string' && isAddress(market);
  if (order.asset_symbol === 'MON' && order.asset_decimals === 18 && validMarket && market.toLowerCase() === config.market_address.toLowerCase()) return { symbol: 'MON', target: 'market', market: getAddress(market) };
  if (order.asset_symbol === 'dUSD' && order.asset_decimals === 6 && validMarket && market.toLowerCase() === config.legacy_market_address?.toLowerCase()) return { symbol: 'dUSD', target: 'legacy-market', market: getAddress(market) };
  // Missing/unknown metadata must never relabel a historical dUSD bill as MON.
  return { symbol: order.asset_symbol === 'dUSD' ? 'dUSD（市场待核对）' : '资产待核对' };
}
