'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPublicClient, formatUnits, http, keccak256, stringToHex, type Hex } from 'viem';
import { parseAmount } from '../lib/assets';
import { short, txUrl } from '../lib/api';
import { chainFor, marketAbi, rpcFor } from '../lib/contracts';
import type { MarketConfig, PriceKey, WalletAccess } from '../lib/types';

interface SellerPanelProps { wallet: WalletAccess; config: MarketConfig; onRefresh: () => Promise<void> }
interface ChainQuote { prices: Record<PriceKey, bigint>; minReserve: bigint; version: bigint; active: boolean }
type QuoteForm = Record<PriceKey | 'minReserve', string>;
const MODEL = 'mock-reasoner';
const MODEL_ID = keccak256(stringToHex(MODEL));
const DEFAULT_FORM: QuoteForm = { input: '0.3', cacheRead: '0.03', cacheWrite: '0.375', output: '0.8', minReserve: '0.000001' };
const PRICE_FIELDS: { key: PriceKey; label: string; description: string }[] = [
  { key: 'input', label: '普通输入', description: '未计入缓存读取或写入的输入。' },
  { key: 'cacheRead', label: '缓存读取', description: '本次命中的模拟缓存输入。' },
  { key: 'cacheWrite', label: '缓存写入', description: '本次新写入模拟缓存的输入。' },
  { key: 'output', label: '生成输出', description: '节点交付的模拟输出 Token。' },
];

const rate = (value: string, label: string) => parseAmount(value, 18, label, true);

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : '操作未完成，请检查钱包提示后重试。'; }

export function SellerPanel({ wallet, config, onRefresh }: SellerPanelProps) {
  const client = useMemo(() => createPublicClient({ chain: chainFor(config.chain_id), transport: http(rpcFor(config.chain_id)) }), [config.chain_id]);
  const [form, setForm] = useState<QuoteForm>({ ...DEFAULT_FORM });
  const [chainQuote, setChainQuote] = useState<{ owner: string; value: ChainQuote } | null>(null);
  const [pending, setPending] = useState('');
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const [transaction, setTransaction] = useState<Hex>();
  const busy = useRef(false);
  const hydratedOwner = useRef('');
  const ownerKey = `${config.chain_id}:${config.market_address}:${wallet.address ?? ''}`;
  const currentOwner = useRef(ownerKey);
  useEffect(() => { currentOwner.current = ownerKey; }, [ownerKey]);

  const refreshQuote = useCallback(async () => {
    const address = wallet.address;
    if (!address) return;
    const quote = await client.readContract({ address: config.market_address, abi: marketAbi, functionName: 'getQuote', args: [address, MODEL_ID] }) as unknown as ChainQuote;
    if (currentOwner.current !== ownerKey) return;
    setChainQuote({ owner: ownerKey, value: quote });
    setReadError('');
    if (hydratedOwner.current !== ownerKey) {
      setForm(quote.version > 0n ? {
        input: formatUnits(quote.prices.input, 18), cacheRead: formatUnits(quote.prices.cacheRead, 18),
        cacheWrite: formatUnits(quote.prices.cacheWrite, 18), output: formatUnits(quote.prices.output, 18),
        minReserve: formatUnits(quote.minReserve, 18),
      } : { ...DEFAULT_FORM });
      hydratedOwner.current = ownerKey;
    }
    return quote;
  }, [client, config.market_address, ownerKey, wallet.address]);

  useEffect(() => {
    let active = true;
    void refreshQuote().catch(() => { if (active) setReadError('暂时无法读取链上报价，请点击重新读取后再操作。'); });
    return () => { active = false; };
  }, [refreshQuote]);

  const displayedQuote = chainQuote?.owner === ownerKey ? chainQuote.value : null;
  const disabled = !wallet.address || Boolean(pending) || !displayedQuote;

  async function run(label: string, action: () => Promise<string>) {
    if (busy.current || !wallet.address) return;
    busy.current = true;
    setPending(label);
    setSuccess('');
    setError('');
    setTransaction(undefined);
    try {
      const message = await action();
      setSuccess(message);
      const refreshed = await Promise.allSettled([refreshQuote(), onRefresh()]);
      if (refreshed.some((result) => result.status === 'rejected')) setReadError('操作已确认，市场状态暂未刷新，请稍后重新读取。');
    } catch (reason) { setError(errorMessage(reason)); }
    finally { busy.current = false; setPending(''); }
  }

  return (
    <section className="panel seller-panel" aria-labelledby="seller-title" aria-busy={Boolean(pending)}>
      <div className="panel-heading">
        <div><p className="eyebrow">PROVIDER QUOTE</p><h2 id="seller-title">发布卖家报价</h2></div>
        <span className={displayedQuote?.active ? 'success' : 'muted'}>{displayedQuote ? displayedQuote.version === 0n ? '尚未挂牌' : displayedQuote.active ? `已启用 · v${displayedQuote.version}` : `已停用 · v${displayedQuote.version}` : '等待读取'}</span>
      </div>
      <p className="muted">模型 <strong>{MODEL}</strong> · 全部推理及缓存效果均为 Mock。四项单价使用 MON / 百万模拟 Token，最多 18 位小数。</p>
      {!wallet.address && <button className="button" type="button" onClick={wallet.connect}>连接卖家钱包</button>}
      <p className="muted">报价所有者与收款钱包：<code>{short(wallet.address)}</code></p>
      {displayedQuote && displayedQuote.version > 0n && <div className="form-grid quote-summary">{PRICE_FIELDS.map(({ key, label }) => <div className="field" key={key}><span className="muted">当前链上 · {label}</span><strong>{formatUnits(displayedQuote.prices[key], 18)}</strong></div>)}<div className="field"><span className="muted">当前最低预留</span><strong>{formatUnits(displayedQuote.minReserve, 18)} MON</strong></div></div>}
      <form onSubmit={(event) => { event.preventDefault(); void run('等待报价发布确认…', async () => {
        const prices = {
          input: rate(form.input, '普通输入单价'), cacheRead: rate(form.cacheRead, '缓存读取单价'),
          cacheWrite: rate(form.cacheWrite, '缓存写入单价'), output: rate(form.output, '输出单价'),
        };
        const minReserve = rate(form.minReserve, '最低预留金额');
        const hash = await wallet.sendContract('market', 'upsertQuote', [MODEL_ID, prices, minReserve, true]);
        setTransaction(hash);
        return '报价已在链上启用。请同步卖家客户端配置并保持节点在线；已锁款订单继续使用原报价。';
      }); }}>
        <fieldset disabled={disabled}>
          <legend>编辑报价</legend>
          <div className="form-grid">
            {PRICE_FIELDS.map(({ key, label, description }) => <label className="field" htmlFor={`seller-${key}`} key={key}>{label}（MON / 百万 Token）<input id={`seller-${key}`} inputMode="decimal" autoComplete="off" value={form[key]} onChange={(event) => setForm((previous) => ({ ...previous, [key]: event.target.value }))} aria-describedby={`seller-${key}-help`} required /><small id={`seller-${key}-help`} className="muted">{description}</small></label>)}
            <label className="field" htmlFor="seller-min-reserve">单次最低预留金额（MON）<input id="seller-min-reserve" inputMode="decimal" autoComplete="off" value={form.minReserve} onChange={(event) => setForm((previous) => ({ ...previous, minReserve: event.target.value }))} aria-describedby="seller-min-help" required /><small id="seller-min-help" className="muted">这是开始请求的最低锁款要求，最终仍按实际用量收费。</small></label>
          </div>
          <button className="button" type="submit">{displayedQuote && displayedQuote.version > 0n ? '更新并启用报价' : '发布并启用报价'}</button>
        </fieldset>
      </form>
      <div className="seller-actions">
        <button className="button secondary" type="button" disabled={disabled || !displayedQuote?.active} onClick={() => void run('等待停用报价确认…', async () => {
          const quote = await refreshQuote();
          if (!quote || quote.version === 0n || !quote.active) throw new Error('当前没有需要停用的有效报价。');
          const hash = await wallet.sendContract('market', 'upsertQuote', [MODEL_ID, quote.prices, quote.minReserve, false]);
          setTransaction(hash);
          return '链上报价已停用，不再接受新锁款。已有订单继续按原规则结算，未保存的表单内容保留。';
        })}>停用当前链上报价</button>
        <button className="button secondary" type="button" disabled={!wallet.address || Boolean(pending)} onClick={() => void run('正在读取链上报价…', async () => { await refreshQuote(); return '链上报价已刷新，正在编辑的内容保留。'; })}>重新读取链上状态</button>
      </div>
      <p className="muted">挂牌交易需要少量测试 MON Gas。挂牌不会自动启动卖家节点；节点需独立运行并主动连接平台，无需提供公网地址。</p>
      {pending && <p className="muted" role="status">{pending}</p>}
      {success && <p className="success" role="status">{success}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {readError && <p className="muted" role="status">{readError}</p>}
      {transaction && <p className="transaction-link">报价交易 · {txUrl(transaction, config.chain_id) ? <a href={txUrl(transaction, config.chain_id)} target="_blank" rel="noreferrer">{short(transaction)} ↗</a> : <code>{short(transaction)}</code>}</p>}
    </section>
  );
}

export default SellerPanel;
