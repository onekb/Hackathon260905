'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPublicClient, formatUnits, http, keccak256, stringToHex, type Address, type Hex } from 'viem';
import { chainFor, legacyMarketAbi, rpcFor, tokenAbi } from '../lib/contracts';
import { parseAmount } from '../lib/assets';
import { short, txUrl } from '../lib/api';
import type { MarketConfig, WalletAccess } from '../lib/types';

interface Props { wallet: WalletAccess; config: MarketConfig }
interface LegacyFunds { wallet: bigint; escrow: bigint; grantId: bigint; grantRevoked: boolean }
interface LegacyOrder { buyer: Address; reserved: bigint; deadline: bigint; state: number }

export default function LegacyAssetsPanel({ wallet, config }: Props) {
  if (!config.legacy_market_address || !config.legacy_token_address) return null;
  return <LegacySession key={`${config.chain_id}:${config.legacy_market_address}:${wallet.address ?? ''}`} wallet={wallet} config={config} market={config.legacy_market_address} token={config.legacy_token_address} />;
}

function LegacySession({ wallet, config, market, token }: Props & { market: Address; token: Address }) {
  const client = useMemo(() => createPublicClient({ chain: chainFor(config.chain_id), transport: http(rpcFor(config.chain_id)) }), [config.chain_id]);
  const [funds, setFunds] = useState<LegacyFunds | null>(null);
  const [withdraw, setWithdraw] = useState('1');
  const [request, setRequest] = useState('');
  const [pending, setPending] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [hash, setHash] = useState<Hex>();
  const alive = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const refresh = useCallback(async () => {
    const address = wallet.address;
    if (!address) return;
    const [walletBalance, escrow, grantId] = await Promise.all([
      client.readContract({ address: token, abi: tokenAbi, functionName: 'balanceOf', args: [address] }),
      client.readContract({ address: market, abi: legacyMarketAbi, functionName: 'balances', args: [address] }),
      client.readContract({ address: market, abi: legacyMarketAbi, functionName: 'activeGrantId', args: [address] }),
    ]) as [bigint, bigint, bigint];
    const grant = grantId > 0n ? await client.readContract({ address: market, abi: legacyMarketAbi, functionName: 'getGrant', args: [address, grantId] }) as { revoked: boolean } : null;
    if (alive.current) setFunds({ wallet: walletBalance, escrow, grantId, grantRevoked: grant?.revoked ?? true });
  }, [client, market, token, wallet.address]);
  useEffect(() => { void refresh().catch(() => { if (alive.current) setError('旧 dUSD 余额读取失败，可稍后重新读取。'); }); }, [refresh]);

  async function transact(label: string, action: () => Promise<string>) {
    if (inFlight.current || !wallet.address) return;
    inFlight.current = true; setPending(label); setMessage(''); setError(''); setHash(undefined);
    try {
      const result = await action();
      if (!alive.current) return;
      setMessage(result);
      await refresh().catch(() => { if (alive.current) setError('交易已确认，但旧余额暂时未刷新，请重新读取。'); });
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : '旧资产操作未完成。'); }
    finally { inFlight.current = false; if (alive.current) setPending(''); }
  }
  async function send(functionName: string, args: readonly unknown[]) {
    if (!alive.current) throw new Error('钱包已切换，请重新发起操作。');
    const tx = await wallet.sendContract('legacy-market', functionName, args);
    if (alive.current) setHash(tx);
  }
  const disabled = !wallet.address || Boolean(pending);
  return <section className="offline-recovery" aria-labelledby="legacy-assets-title">
    <h3 id="legacy-assets-title">旧 dUSD 资产与锁款回收</h3>
    <p className="muted">旧市场资产独立保留，按 6 位小数记账，不会兑换或合并为 MON。此入口只管理旧余额和旧订单；新推理使用上方 MON 市场。提款和回收仍需钱包 MON 支付 Gas。</p>
    <p className="muted">旧托管合约 <code style={{ overflowWrap: 'anywhere' }}>{market}</code></p>
    {!wallet.address && <button className="button secondary" type="button" onClick={wallet.connect}>连接原买家钱包</button>}
    <div className="form-grid">
      <div className="field"><span>钱包旧 dUSD</span><strong>{funds ? formatUnits(funds.wallet, 6) : '—'} dUSD</strong></div>
      <div className="field"><span>旧可用托管余额</span><strong>{funds ? formatUnits(funds.escrow, 6) : '—'} dUSD</strong></div>
    </div>
    <div className="form-grid">
      <form onSubmit={event => { event.preventDefault(); void transact('等待旧 dUSD 提款确认…', async () => {
        const amount = parseAmount(withdraw, 6, '旧 dUSD 提款金额');
        const available = await client.readContract({ address: market, abi: legacyMarketAbi, functionName: 'balances', args: [wallet.address!] }) as bigint;
        if (amount > available) throw new Error('旧 dUSD 提款金额超过可用托管余额。');
        await send('withdraw', [amount]);
        return `已提回 ${formatUnits(amount, 6)} dUSD 至原钱包。`;
      }); }}>
        <fieldset disabled={disabled}><legend>提回旧资产</legend><label className="field">提款金额（dUSD）<input inputMode="decimal" value={withdraw} onChange={event => setWithdraw(event.target.value)} required /></label><button className="button secondary" type="submit">提回旧 dUSD</button></fieldset>
      </form>
      <form onSubmit={event => { event.preventDefault(); void transact('检查旧订单并回收超时锁款…', async () => {
        const input = request.trim();
        const id = /^0x[0-9a-fA-F]{64}$/.test(input) ? input as Hex : /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(input) ? keccak256(stringToHex(input.toLowerCase())) : undefined;
        if (!id) throw new Error('请输入旧账单的完整 UUID 或链上 bytes32 订单 ID。');
        const block = await client.getBlock({ blockTag: 'latest' });
        const order = await client.readContract({ address: market, abi: legacyMarketAbi, functionName: 'getOrder', args: [id], blockNumber: block.number }) as LegacyOrder;
        if (order.state === 0) throw new Error('旧 dUSD 市场未找到此订单；MON 订单请使用上方入口。');
        if (order.buyer.toLowerCase() !== wallet.address?.toLowerCase()) throw new Error('旧订单不属于当前钱包。');
        if (order.state !== 1) throw new Error(order.state === 2 ? '旧订单已结算，无需重复回收。' : '旧订单锁款已回收。');
        if (block.timestamp < order.deadline) throw new Error(`旧订单尚未到期，按链上时间还需等待 ${order.deadline - block.timestamp} 秒。`);
        await send('reclaimExpired', [id]);
        return `已释放 ${formatUnits(order.reserved, 6)} dUSD 至旧托管余额，可从左侧提款。`;
      }); }}>
        <fieldset disabled={disabled}><legend>回收旧订单锁款</legend><label className="field">旧订单 UUID 或链上订单 ID<input value={request} onChange={event => setRequest(event.target.value)} autoComplete="off" spellCheck={false} required /></label><button className="button secondary" type="submit">检查并取回旧锁款</button></fieldset>
      </form>
    </div>
    <button className="button secondary" type="button" disabled={disabled || !funds || funds.grantRevoked} onClick={() => void transact('等待撤销旧消费授权…', async () => { await send('revokeRouter', []); return '已撤销旧市场消费授权，旧订单仍按原规则结算。'; })}>撤销旧 dUSD 消费授权</button>
    <button className="button secondary" type="button" disabled={disabled} onClick={() => void transact('正在读取旧余额…', async () => '旧资产余额已刷新。')}>重新读取旧资产</button>
    {pending && <p role="status" className="muted">{pending}</p>}{message && <p role="status" className="success">{message}</p>}{error && <p role="alert" className="error">{error}</p>}
    {hash && <p className="muted">旧资产交易 · {txUrl(hash, config.chain_id) ? <a href={txUrl(hash, config.chain_id)} target="_blank" rel="noreferrer">{short(hash)} ↗</a> : <code>{short(hash)}</code>}</p>}
  </section>;
}
