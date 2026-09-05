'use client';

import dynamic from 'next/dynamic';

const ProviderConnect = dynamic(() => import('./provider-connect'), {
  ssr: false,
  loading: () => <div className="boot">正在准备卖家钱包连接…</div>,
});

export default function ProviderConnectApp() { return <ProviderConnect />; }
