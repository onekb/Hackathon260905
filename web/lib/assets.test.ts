import test from 'node:test';
import assert from 'node:assert/strict';
import { LEGACY_MARKET, LEGACY_TOKEN, formatAmount, orderAsset, parseAmount, validateMarketConfig } from './assets';
import type { MarketConfig, Order } from './types';

const nativeMarket = '0x0000000000000000000000000000000000001234';
const config: MarketConfig = { chain_id: 10143, chain_mode: 'monad-testnet', mock_inference: true, market_address: nativeMarket, asset_symbol: 'MON', asset_decimals: 18, legacy_market_address: LEGACY_MARKET, legacy_token_address: LEGACY_TOKEN, legacy_asset_symbol: 'dUSD' };

test('MON input preserves one wei and rejects truncation, exponent and overflowing amounts', () => {
  assert.equal(parseAmount('0.000000000000000001', 18, 'MON'), 1n);
  assert.equal(parseAmount('0.1', 18, 'MON'), 100_000_000_000_000_000n);
  assert.equal(parseAmount('0.1', 6, 'dUSD'), 100_000n);
  for (const input of ['0.0000000000000000001', '1e-3', '-1', '0', String(2n ** 256n)]) assert.throws(() => parseAmount(input, 18, 'MON'));
  assert.throws(() => parseAmount('0.0000001', 6, 'dUSD'));
});

test('bill display never rounds a real small charge to zero or loses large-integer precision', () => {
  assert.equal(formatAmount('0.000000000000000001'), '0.000000000000000001');
  assert.equal(formatAmount('9007199254740993.001000'), '9,007,199,254,740,993.001');
  assert.equal(formatAmount('0.014160'), '0.01416');
});

test('historical recovery uses its original asset and market, never the current native contract', () => {
  const legacy: Pick<Order, 'asset_symbol' | 'asset_decimals' | 'market_address'> = { asset_symbol: 'dUSD', asset_decimals: 6, market_address: LEGACY_MARKET };
  assert.equal(orderAsset(legacy, config).target, 'legacy-market');
  assert.equal(orderAsset(legacy, config).symbol, 'dUSD');
  assert.equal(orderAsset({ ...legacy, market_address: nativeMarket }, config).target, undefined);
  assert.equal(orderAsset({ ...legacy, asset_symbol: 'MON', asset_decimals: 18 }, config).target, undefined);
  assert.equal(orderAsset({} as Order, config).target, undefined);
  assert.equal(orderAsset({} as Order, config).symbol, '资产待核对');
});

test('old asset endpoint cannot pass as a native market during migration', () => {
  assert.equal(validateMarketConfig(config, nativeMarket), config);
  assert.throws(() => validateMarketConfig({ ...config, market_address: LEGACY_MARKET }));
  assert.throws(() => validateMarketConfig({ ...config, asset_decimals: 6 } as unknown as MarketConfig));
  assert.throws(() => validateMarketConfig(config, '0x0000000000000000000000000000000000004321'));
  assert.throws(() => validateMarketConfig(config, '0x0000000000000000000000000000000000000000'));
  assert.throws(() => validateMarketConfig({ ...config, legacy_market_address: undefined }, nativeMarket));
});
