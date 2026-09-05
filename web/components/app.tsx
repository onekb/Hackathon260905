'use client';
import dynamic from 'next/dynamic';
import Dashboard from './dashboard';
import { deployedConfig } from '@/lib/contracts';
import { useMarketConfig } from '@/lib/use-market-config';
import type { WalletAccess } from '@/lib/types';
import AccountPanel from './account-panel';
const ParaWallet = dynamic(() => import('./para-wallet'), { ssr: false, loading: () => <div className="boot">正在连接钱包组件…</div> });
const unavailable: WalletAccess = { connect: () => alert('钱包配置尚未完成，请稍后刷新。'), signMessage: async () => { throw new Error('钱包未连接'); }, sendContract: async () => { throw new Error('钱包未连接'); } };
export default function App() {
  const { config, error } = useMarketConfig();
  if (!config) {
    if (!error) return <div className="boot">正在读取原生 MON 市场…</div>;
    const recovery = (wallet: WalletAccess) => <main><section className="panel"><h1>市场暂时无法连接</h1><p className="error">{error}</p><p className="muted">市场恢复前无法发起推理请求。仍可通过当前 MON 合约管理余额、撤销授权或回收超时锁款。</p><button className="button secondary" onClick={() => window.location.reload()}>重新连接市场</button></section><AccountPanel key={wallet.address ?? 'disconnected'} wallet={wallet} config={deployedConfig} account={null} onRefresh={async () => {}}/></main>;
    return process.env.NEXT_PUBLIC_PARA_API_KEY ? <ParaWallet config={deployedConfig}>{recovery}</ParaWallet> : recovery(unavailable);
  }
  if (!process.env.NEXT_PUBLIC_PARA_API_KEY) return <Dashboard wallet={unavailable} config={config} />;
  return <ParaWallet config={config}>{wallet => <Dashboard wallet={wallet} config={config} />}</ParaWallet>;
}
