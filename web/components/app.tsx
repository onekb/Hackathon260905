'use client';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import Dashboard from './dashboard';
import { api } from '@/lib/api';
import { deployedConfig } from '@/lib/contracts';
import type { MarketConfig, WalletAccess } from '@/lib/types';
const ParaWallet = dynamic(() => import('./para-wallet'), { ssr: false, loading: () => <div className="boot">正在连接钱包组件…</div> });
const unavailable: WalletAccess = { connect: () => alert('钱包配置尚未完成，请稍后刷新。'), signMessage: async () => { throw new Error('钱包未连接'); }, sendContract: async () => { throw new Error('钱包未连接'); } };
export default function App() {
  const [config, setConfig] = useState<MarketConfig>(deployedConfig);
  useEffect(() => { void api<MarketConfig>('/config').then(c => {
    if (![10143, 31337].includes(c.chain_id)) throw new Error('Unsupported chain');
    if (c.chain_id === 10143 && (c.market_address.toLowerCase() !== deployedConfig.market_address.toLowerCase() || c.token_address.toLowerCase() !== deployedConfig.token_address.toLowerCase())) throw new Error('Contract configuration mismatch');
    setConfig(c);
  }).catch(() => {}); }, []);
  if (!process.env.NEXT_PUBLIC_PARA_API_KEY) return <Dashboard wallet={unavailable} config={config} />;
  return <ParaWallet config={config}>{wallet => <Dashboard wallet={wallet} config={config} />}</ParaWallet>;
}
