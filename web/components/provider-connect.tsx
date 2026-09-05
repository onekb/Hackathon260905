'use client';

import { useEffect, useRef, useState } from 'react';
import { verifyMessage } from 'viem';
import ParaWallet from './para-wallet';
import { api, ROUTER_URL } from '@/lib/api';
import { deployedConfig } from '@/lib/contracts';
import type { MarketConfig, WalletAccess } from '@/lib/types';
import { parseBrowserProviderChallenge, parseBrowserProviderInfo, parseLoopbackOrigin, type BrowserProviderInfo } from '../../shared/browser-wallet';

const routerOrigin = new URL(ROUTER_URL).origin;
type Phase = 'idle' | 'ready' | 'signing' | 'signed' | 'online' | 'error';

export default function ProviderConnect() {
  const [config, setConfig] = useState<MarketConfig>(deployedConfig);
  useEffect(() => {
    let active = true;
    void api<MarketConfig>('/config').then(value => {
      if (![10143, 31337].includes(value.chain_id)) throw new Error('Unsupported chain');
      if (value.chain_id === 10143 && (value.market_address.toLowerCase() !== deployedConfig.market_address.toLowerCase()
        || value.token_address.toLowerCase() !== deployedConfig.token_address.toLowerCase())) throw new Error('Contract mismatch');
      if (active) setConfig(value);
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  if (!process.env.NEXT_PUBLIC_PARA_API_KEY) return <main className="provider-connect"><p className="error">网页钱包尚未配置，请联系平台维护者。</p></main>;
  return <ParaWallet config={config}>{wallet => <ConnectionSession key={`${config.chain_id}:${wallet.address ?? 'disconnected'}`} wallet={wallet} />}</ParaWallet>;
}

function ConnectionSession({ wallet }: { wallet: WalletAccess }) {
  const [endpoint] = useState(() => {
    try {
      const origin = parseLoopbackOrigin(new URLSearchParams(window.location.search).get('node_origin'));
      const opener: Window | null = window.opener;
      if (!opener || opener.closed) throw new Error('请从卖家客户端点击“连接网页钱包”打开本窗口。');
      return { origin, opener, error: '' };
    } catch (reason) {
      return { origin: '', opener: null, error: reason instanceof Error ? reason.message : '无法连接本地节点。' };
    }
  });
  const [info, setInfo] = useState<BrowserProviderInfo | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState(endpoint.error);
  const acceptedInfo = useRef<BrowserProviderInfo | null>(null);
  const armed = useRef(false);
  const operation = useRef(0);
  const usedNonces = useRef(new Set<string>());
  const usedRequests = useRef(new Set<string>());
  const latestWallet = useRef(wallet);
  const handshakeStarted = useRef(false);

  useEffect(() => { latestWallet.current = wallet; }, [wallet]);

  useEffect(() => {
    const opener = endpoint.opener;
    if (!opener || !endpoint.origin) return;
    let alive = true;
    const send = (payload: unknown) => { if (alive && !opener.closed) opener.postMessage(payload, endpoint.origin); };
    const fail = (message: string, requestId?: string) => {
      armed.current = false;
      operation.current++;
      setPhase('error');
      setError(message);
      send({ type: 'inferpool:provider-signing-error', requestId, message });
    };
    const receive = async (event: MessageEvent) => {
      if (event.source !== opener || event.origin !== endpoint.origin || !event.data || typeof event.data !== 'object') return;
      const data = event.data as Record<string, unknown>;
      if (data.type === 'inferpool:provider-info') {
        try {
          const next = parseBrowserProviderInfo(data, endpoint.origin, routerOrigin);
          const previous = acceptedInfo.current;
          if (previous && (previous.wallet !== next.wallet || previous.providerId !== next.providerId)) throw new Error('节点身份已变化，请从客户端重新打开连接窗口。');
          acceptedInfo.current = next;
          setInfo(next);
        } catch (reason) { fail(reason instanceof Error ? reason.message : '节点身份无效。'); }
        return;
      }
      if (data.type === 'inferpool:provider-signing-error') {
        armed.current = false;
        operation.current++;
        setPhase('error');
        setError(typeof data.message === 'string' ? data.message.slice(0, 240) : '节点连接未完成，请重试。');
        return;
      }
      if (data.type === 'inferpool:provider-status') {
        if (data.status === 'online') {
          armed.current = false;
          setPhase('online');
          setError('');
        } else if (['offline', 'reconnecting'].includes(String(data.status))) {
          armed.current = false;
          operation.current++;
          setPhase('error');
          setError(typeof data.message === 'string' ? data.message.slice(0, 240) : '本次连接已结束。');
        }
        return;
      }
      if (data.type !== 'inferpool:provider-challenge' || !armed.current) return;
      let requestId: string | undefined;
      try {
        const node = acceptedInfo.current;
        const signingWallet = latestWallet.current;
        if (!node || !signingWallet.address || signingWallet.address.toLowerCase() !== node.wallet.toLowerCase()) throw new Error('当前钱包与节点收款地址不一致。');
        const challenge = parseBrowserProviderChallenge(data, routerOrigin);
        requestId = challenge.requestId;
        if (usedNonces.current.has(challenge.nonce) || usedRequests.current.has(requestId)) throw new Error('此节点登录挑战已经处理，请重新连接。');
        armed.current = false;
        usedNonces.current.add(challenge.nonce);
        usedRequests.current.add(requestId);
        const attempt = operation.current;
        setPhase('signing');
        const signature = await signingWallet.signMessage(challenge.message);
        if (!alive || attempt !== operation.current || opener.closed) return;
        if (Date.now() >= challenge.expiresAt) throw new Error('签名时节点登录挑战已过期，请重新连接。');
        if (!await verifyMessage({ address: node.wallet, message: challenge.message, signature })) throw new Error('钱包签名与节点收款地址不一致。');
        if (!alive || attempt !== operation.current) return;
        send({ type: 'inferpool:provider-signature', requestId, signature });
        setPhase('signed');
      } catch (reason) {
        if (alive) fail(reason instanceof Error ? reason.message : '节点登录签名未完成。', requestId);
      }
    };
    const listener = (event: MessageEvent) => { void receive(event); };
    const close = () => {
      send({ type: 'inferpool:provider-signing-error', message: '钱包连接窗口已离开，请重新连接。' });
      armed.current = false;
      operation.current++;
    };
    window.addEventListener('message', listener);
    window.addEventListener('pagehide', close);
    send({ type: 'inferpool:popup-ready' });
    return () => {
      if (handshakeStarted.current) send({ type: 'inferpool:provider-signing-error', message: '钱包身份或连接页面已改变，请重新连接节点。' });
      alive = false;
      armed.current = false;
      window.removeEventListener('message', listener);
      window.removeEventListener('pagehide', close);
    };
  }, [endpoint]);

  const matches = Boolean(info && wallet.address?.toLowerCase() === info.wallet.toLowerCase());
  const busy = ['ready', 'signing', 'signed'].includes(phase);
  function connect() {
    if (!matches || !endpoint.opener || endpoint.opener.closed || phase !== 'idle') return;
    operation.current++;
    handshakeStarted.current = true;
    armed.current = true;
    setError('');
    setPhase('ready');
    endpoint.opener.postMessage({ type: 'inferpool:wallet-ready', wallet: wallet.address }, endpoint.origin);
  }
  const labels: Record<Phase, string> = {
    idle: '准备连接', ready: '正在获取本次节点登录挑战…', signing: '正在签署本次节点登录…',
    signed: '签名已提交，等待平台确认节点…', online: '卖家节点已在线。', error: '连接未完成',
  };
  return <main className="provider-connect">
    <section className="panel">
      <p className="eyebrow">INFERPOOL / SELLER CONNECTION</p>
      <h1>连接卖家节点</h1>
      <p className="muted">用网页钱包确认这个本地节点的身份。节点独立运行并接收模拟推理请求。</p>
      <dl>
        <div><dt>本地客户端</dt><dd>{endpoint.origin || '未连接'}</dd></div>
        <div><dt>接入平台</dt><dd>{routerOrigin}</dd></div>
        <div><dt>节点 ID</dt><dd>{info?.providerId ?? '等待客户端提供身份…'}</dd></div>
        <div><dt>节点收款钱包</dt><dd><code>{info?.wallet ?? '等待确认…'}</code></dd></div>
        <div><dt>当前网页钱包</dt><dd><code>{wallet.address ?? '未登录'}</code></dd></div>
      </dl>
      <p className="muted">点击连接后，只为本次节点登录签名。资金消费授权、报价发布与提款仍在各自页面单独操作。重连时需再次确认。</p>
      {!wallet.address && <button className="button" onClick={wallet.connect}>登录卖家钱包</button>}
      {wallet.address && info && !matches && <p className="error">当前钱包与节点收款地址不一致，请在钱包中切换到上方节点地址。</p>}
      {wallet.address && <button className="button" disabled={!matches || phase !== 'idle'} onClick={connect}>签名并连接节点</button>}
      {busy && <p role="status" className="muted">{labels[phase]}</p>}
      {phase === 'online' && <p role="status" className="success">卖家节点已在线。请保持客户端和此窗口打开；关闭任一窗口会让节点下线。</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {phase === 'error' && <p className="muted">请回到本地客户端，重新点击“连接网页钱包”打开新的连接窗口。</p>}
      <p className="fine-print">Monad 测试网 · 模拟推理 · 私钥保留在网页钱包中</p>
    </section>
  </main>;
}
