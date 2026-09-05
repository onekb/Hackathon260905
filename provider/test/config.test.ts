import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseConfig, validatePricing } from '../src/config.js';

test('local insecure WS is allowed; remote WS and URL credentials are rejected', () => {
  assert.equal(parseConfig([], {}).router, 'ws://127.0.0.1:8787/provider');
  assert.equal(parseConfig(['--router', 'wss://example.com/provider'], {}).router, 'wss://example.com/provider');
  assert.throws(() => parseConfig(['--router', 'ws://example.com/provider'], {}), /wss/);
  assert.throws(() => parseConfig(['--router', 'wss://user:pass@example.com/provider'], {}), /凭证/);
});

test('CLI isolates two seller IDs and console ports and accepts an explicit ephemeral wallet', () => {
  const config = parseConfig(['--id', 'seller-b', '--port', '8792', '--mode', 'fail-mid', '--ephemeral-wallet', '--output-price', '60'], {});
  assert.equal(config.id, 'seller-b');
  assert.equal(config.port, 8792);
  assert.equal(config.mode, 'fail-mid');
  assert.equal(config.ephemeral, true);
  assert.equal(config.pricing.output, '60');
});

test('invalid decimal pricing, unsafe capacities and private-key CLI arguments are rejected', () => {
  assert.throws(() => validatePricing({ input: '-1' }), /报价/);
  assert.throws(() => parseConfig(['--capacity', '0'], {}), /capacity/);
  assert.throws(() => parseConfig(['--private-key', 'secret'], {}), /未知选项/);
  assert.throws(() => parseConfig(['--mode', 'real-model'], {}), /Mock/);
});

test('Alchemy session is explicit and mutually exclusive with both other wallet sources', () => {
  assert.equal(parseConfig(['--alchemy-session'], {}).alchemySession, true);
  assert.equal(parseConfig([], { PROVIDER_ALCHEMY_SESSION: 'true' }).alchemySession, true);
  assert.throws(() => parseConfig(['--alchemy-session', '--ephemeral-wallet'], {}), /互斥/);
  assert.throws(() => parseConfig(['--alchemy-session'], { PROVIDER_PRIVATE_KEY: 'set-in-local-env' }), /互斥/);
  assert.throws(() => parseConfig(['--ephemeral-wallet'], { PROVIDER_PRIVATE_KEY: 'set-in-local-env' }), /互斥/);
  assert.equal(parseConfig([], {}).alchemySession, false);
});

test('browser wallet requires an explicit address and strict paired wallet UI origin', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const args = ['--browser-wallet', address, '--wallet-ui', 'http://127.0.0.1:3000'];
  const config = parseConfig(args, {});
  assert.equal(config.browserWallet, address);
  assert.equal(config.walletUi, 'http://127.0.0.1:3000');
  assert.equal(parseConfig(['--browser-wallet', address, '--wallet-ui', 'https://wallet.example/'], {}).walletUi, 'https://wallet.example');
  for (const url of ['http://wallet.example', 'https://u:p@wallet.example', 'https://wallet.example/path', 'https://wallet.example/?x=1', 'https://wallet.example/#x', 'https://wallet.example?', 'http://127.0.0.1:3000\\']) {
    assert.throws(() => parseConfig(['--browser-wallet', address, '--wallet-ui', url], {}), /wallet-ui/);
  }
  assert.throws(() => parseConfig(['--browser-wallet', address], {}), /同时/);
  assert.throws(() => parseConfig(['--wallet-ui', 'http://localhost:3000'], {}), /同时/);
  assert.throws(() => parseConfig(['--browser-wallet', '0x123', '--wallet-ui', 'http://localhost:3000'], {}), /地址/);
  assert.throws(() => parseConfig([...args, '--alchemy-session'], {}), /互斥/);
  assert.throws(() => parseConfig([...args, '--ephemeral-wallet'], {}), /互斥/);
  assert.throws(() => parseConfig(args, { PROVIDER_PRIVATE_KEY: 'present' }), /互斥/);
});
