import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import AccountPanel from './account-panel';
import { deployedConfig } from '../lib/contracts';
import type { WalletAccess } from '../lib/types';

const wallet: WalletAccess = {
  address: '0x0000000000000000000000000000000000001234',
  connect: () => { throw new Error('Rendering must not connect a wallet'); },
  signMessage: async () => { throw new Error('Rendering must not sign'); },
  sendContract: async () => { throw new Error('Rendering must not transact'); },
};

test('connected wallet can revoke on-chain authorization without a Router session', () => {
  const html = renderToStaticMarkup(<AccountPanel wallet={wallet} config={deployedConfig} account={null} onRefresh={async () => {}} />);
  const button = html.match(/<button\b([^>]*)>撤销消费授权<\/button>/);
  assert.ok(button, 'revoke action is visible');
  assert.doesNotMatch(button[1], /\bdisabled\b/);
  assert.match(html, /撤销操作会直接核对链上状态/);
});

test('revoke still requires an actual connected wallet', () => {
  const html = renderToStaticMarkup(<AccountPanel wallet={{ ...wallet, address: undefined }} config={deployedConfig} account={null} onRefresh={async () => {}} />);
  assert.match(html, /<button\b[^>]*disabled=""[^>]*>撤销消费授权<\/button>/);
});
