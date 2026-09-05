import { getAddress, isAddress, parseUnits, zeroAddress, type Address } from 'viem';
import type { ContractTarget, MarketConfig, Order } from './types';

export function parseAmount(value: string, decimals: 18, label: string, allowZero = false): bigint {
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
    || !isAddress(config.market_address) || config.market_address === zeroAddress) throw new Error('平台尚未提供有效的原生 MON 市场配置。');
  if (config.chain_id === 10143 && expectedMarket === zeroAddress) throw new Error('此版本前端尚未绑定已验证的原生 MON 合约。');
  if (config.chain_id === 10143 && expectedMarket && config.market_address.toLowerCase() !== expectedMarket.toLowerCase()) throw new Error('平台市场合约与此版本前端不一致。');
  return config;
}

export function orderAsset(order: Pick<Order, 'asset_symbol' | 'asset_decimals' | 'market_address'>, config: MarketConfig): { symbol: string; target?: ContractTarget; market?: Address } {
  const market = order.market_address;
  const validMarket = typeof market === 'string' && isAddress(market);
  if (order.asset_symbol === 'MON' && order.asset_decimals === 18 && validMarket && market.toLowerCase() === config.market_address.toLowerCase()) return { symbol: 'MON', target: 'market', market: getAddress(market) };
  // Unknown or incomplete metadata cannot authorize recovery against the current market.
  return { symbol: '资产待核对' };
}
