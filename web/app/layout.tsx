import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
export const metadata: Metadata = { title: 'InferPool · AI 推理市场', description: '在 Monad 测试网上选择推理节点，按实际用量结算。黑客松 Mock 演示。' };
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
