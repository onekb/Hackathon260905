import test from 'node:test';
import assert from 'node:assert/strict';
import { formatAmount, orderAsset, parseAmount, validateMarketConfig } from './assets';
import type { MarketConfig, Order } from './types';

const nativeMarket = '0x0000000000000000000000000000000000001234';
const anotherMarket = '0x0000000000000000000000000000000000004321';
const config: MarketConfig = { chain_id: 10143, chain_mode: 'monad-testnet', mock_inference: true, market_address: nativeMarket, asset_symbol: 'MON', asset_decimals: 18 };

test('MON input preserves one wei and rejects truncation, exponent and overflowing amounts', () => {
  assert.equal(parseAmount('0.000000000000000001', 18, 'MON'), 1n);
  assert.equal(parseAmount('0.1', 18, 'MON'), 100_000_000_000_000_000n);
  for (const input of ['0.0000000000000000001', '1e-3', '-1', '0', String(2n ** 256n)]) assert.throws(() => parseAmount(input, 18, 'MON'));
});

test('bill display never rounds a real small charge to zero or loses large-integer precision', () => {
  assert.equal(formatAmount('0.000000000000000001'), '0.000000000000000001');
  assert.equal(formatAmount('9007199254740993.001000'), '9,007,199,254,740,993.001');
  assert.equal(formatAmount('0.014160'), '0.01416');
});

test('only matching native MON metadata enables current-market recovery', () => {
  const order: Pick<Order, 'asset_symbol' | 'asset_decimals' | 'market_address'> = { asset_symbol: 'MON', asset_decimals: 18, market_address: nativeMarket };
  assert.equal(orderAsset(order, config).target, 'market');
  assert.equal(orderAsset(order, config).symbol, 'MON');
  for (const unknown of [
    { ...order, market_address: anotherMarket },
    { ...order, asset_symbol: 'UNKNOWN' },
    { ...order, asset_decimals: 8 },
    { ...order, market_address: 'invalid' },
  ]) {
    assert.equal(orderAsset(unknown as Order, config).target, undefined);
    assert.equal(orderAsset(unknown as Order, config).symbol, '资产待核对');
  }
  assert.equal(orderAsset({} as Order, config).target, undefined);
  assert.equal(orderAsset({} as Order, config).symbol, '资产待核对');
});

test('configuration must match the pinned native market and asset metadata', () => {
  assert.equal(validateMarketConfig(config, nativeMarket), config);
  assert.throws(() => validateMarketConfig({ ...config, market_address: '0x0000000000000000000000000000000000000000' }));
  assert.throws(() => validateMarketConfig({ ...config, asset_decimals: 8 } as unknown as MarketConfig));
  assert.throws(() => validateMarketConfig({ ...config, asset_symbol: undefined } as unknown as MarketConfig));
  assert.throws(() => validateMarketConfig(config, anotherMarket));
  assert.throws(() => validateMarketConfig(config, '0x0000000000000000000000000000000000000000'));
});
