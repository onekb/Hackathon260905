'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowDownLeft, ArrowUpRight, ArrowRight, Box, Braces, Check, CircleStop, Copy, Layers3, LoaderCircle, Play, Radio, RefreshCw, ShieldCheck, Terminal, Wallet } from 'lucide-react';
import { keccak256, stringToHex } from 'viem';
import { api, ApiError, post, ROUTER_URL, short, txUrl } from '@/lib/api';
import { formatAmount, orderAsset, parseAmount } from '@/lib/assets';
import { executionEnded, newerSnapshot, type OrderSnapshot as Snapshot } from '@/lib/order-snapshot';
import type { AccountInfo, ApiKeyInfo, MarketConfig, Order, PriceKey, Seller, WalletAccess } from '@/lib/types';
import AccountPanel from './account-panel';
import SellerPanel from './seller-panel';
const priceLabels: Record<PriceKey, string> = { input: '普通输入', cacheRead: '缓存读取', cacheWrite: '缓存写入', output: '输出' };
const statuses: Record<string, string> = { locking: '确认锁款', running: '正在生成', completed: '生成完成', budget_capped: '预算 / 输出上限', buyer_cancelled: '买家已取消', seller_failed: '卖家故障 · 全免', platform_failed: '平台故障 · 全免', lock_failed: '锁款失败', reservation_unknown: '正在核对锁款' };
const money = formatAmount;
const isRunning = (o: Order | null) => !!o && ['locking', 'running'].includes(o.status);
const settlementLabel = (o: Order) => o.billConfirmed ? '已确认' : o.status === 'lock_failed' ? '未锁款' : o.status === 'reservation_unknown' ? '核对中' : o.settlement === 'failed' ? '待重试' : o.settlement === 'pending' ? '结算中' : '未提交';
const messageOf = (e: unknown) => e instanceof Error ? e.message : '操作未完成，请稍后重试。';
type RequestAttempt = Readonly<{ key: string; body: string; requestId?: string; ended: boolean }>;
export default function Dashboard({ wallet, config }: { wallet: WalletAccess; config: MarketConfig }) {
  const [tab, setTab] = useState('play');
  // A new component instance isolates even A -> B -> A wallet switches and network changes.
  const identity = `${config.chain_id}:${config.market_address.toLowerCase()}:${wallet.address?.toLowerCase() ?? 'disconnected'}`;
  return <DashboardSession key={identity} wallet={wallet} config={config} tab={tab} setTab={setTab}/>;
}
function DashboardSession({ wallet, config, tab, setTab }: { wallet: WalletAccess; config: MarketConfig; tab: string; setTab: (tab: string) => void }) {
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [online, setOnline] = useState(false);
  const [session, setSession] = useState<{ token: string; wallet: string; id: string } | null>(null);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [order, setOrder] = useState<Order | null>(null);
  const [provider, setProvider] = useState('auto');
  const [model, setModel] = useState('mock-reasoner');
  const [prompt, setPrompt] = useState('用三个要点解释：链上托管如何保护买家的推理预算？');
  const [budget, setBudget] = useState('0.001');
  const [maxTokens, setMaxTokens] = useState('512');
  const [cache, setCache] = useState(false);
  const [busy, setBusy] = useState('');
  const waitingForBudget = busy === 'request' && (!order || order.status === 'locking');
  const [error, setError] = useState('');
  const [retryRequest, setRetryRequest] = useState(false);
  const [cancelling, setCancelling] = useState('');
  const alive = useRef(true);
  const busyRef = useRef('');
  const cancelRef = useRef('');
  const streamRef = useRef<AbortController | null>(null);
  const attemptRef = useRef<RequestAttempt | null>(null);
  const selectedOrder = useRef<string | null>(null);
  const snapshots = useRef(new Map<string, Snapshot>());
  const refreshSequence = useRef(0);
  const address = wallet.address?.toLowerCase();
  const token = session && address && session.wallet === address ? session.token : undefined;
  const latestToken = useRef(token);
  useEffect(() => { latestToken.current = token; }, [token]);
  const expireSession = useCallback((failedToken: string) => {
    if (!alive.current || latestToken.current !== failedToken) return;
    latestToken.current = undefined;
    setSession(null);
    setAccount(null);
    // Reconnect the same request after login; closing SSE never cancels the order.
    streamRef.current?.abort();
    setError('平台登录已失效，请重新签名登录。原订单不会自动取消，登录后可恢复同一请求或取消。');
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; streamRef.current?.abort(); };
  }, []);
  const acceptOrder = useCallback((incoming: Snapshot) => {
    if (!alive.current || incoming.buyer?.toLowerCase() !== address) return;
    const next = newerSnapshot(snapshots.current.get(incoming.id), incoming);
    snapshots.current.set(next.id, next);
    if (selectedOrder.current === next.id) setOrder(next);
    setOrders(list => [next, ...list.filter(item => item.id !== next.id)].sort((a, b) => b.createdAt - a.createdAt));
    const attempt = attemptRef.current;
    if (attempt?.requestId === next.id && executionEnded(next)) {
      attemptRef.current = { ...attempt, ended: true };
      setRetryRequest(false);
    }
  }, [address]);
  function selectOrder(next: Order) {
    if (next.buyer.toLowerCase() !== address) return;
    selectedOrder.current = next.id;
    setOrder(snapshots.current.get(next.id) ?? next);
  }
  const refreshPublic = useCallback(() => api<{data:Seller[]}>('/v1/models').then(m => {
    if (alive.current) { setSellers(m.data); setOnline(true); }
  }).catch(() => { if (alive.current) setOnline(false); }), []);
  const refresh = useCallback(() => {
    if (!alive.current) return Promise.resolve();
    const sequence = ++refreshSequence.current;
    return refreshPublic().then(async () => {
      if (!token || !alive.current) return;
      const [a, list] = await Promise.all([api<AccountInfo>('/account', token), api<{data:Order[]}>('/v1/requests', token)]);
      if (!alive.current || sequence !== refreshSequence.current || latestToken.current !== token) return;
      if (a.wallet.toLowerCase() !== address) throw new Error('返回的账户与当前钱包不匹配。');
      setAccount(a);
      for (const incoming of list.data) acceptOrder(incoming);
    }).catch(e => {
      if (!alive.current || sequence !== refreshSequence.current) return;
      if (e instanceof ApiError && e.status === 401 && token) expireSession(token);
      else setError(messageOf(e));
    });
  }, [token, address, refreshPublic, acceptOrder, expireSession]);
  useEffect(() => { void refreshPublic(); const id = setInterval(() => void refreshPublic(), 5000); return () => clearInterval(id); }, [refreshPublic]);
  useEffect(() => { if (token) void refresh(); }, [token, refresh]);
  const orderId = order?.id;
  const needsPolling = !!order && !order.billConfirmed && order.status !== 'lock_failed';
  useEffect(() => {
    if (!token || !orderId || !needsPolling) return;
    const abort = new AbortController();
    let inFlight = false;
    const id = setInterval(() => {
      if (inFlight || !alive.current) return;
      inFlight = true;
      void api<Order>(`/v1/requests/${orderId}`, token, { signal: abort.signal }).then(next => {
        if (!abort.signal.aborted) acceptOrder(next);
      }).catch(e => {
        if (!abort.signal.aborted && e instanceof ApiError && e.status === 401) expireSession(token);
        // Keep the last known bill; a read failure is not settlement success.
      }).finally(() => { inFlight = false; });
    }, 4000);
    return () => { clearInterval(id); abort.abort(); };
  }, [orderId, needsPolling, token, acceptOrder, expireSession]);
  async function authenticate() {
    if (busyRef.current) return;
    if (!wallet.address) return wallet.connect();
    busyRef.current = 'login'; setBusy('login'); setError('');
    const loginAddress = wallet.address.toLowerCase();
    try {
      const c = await api<{nonce:string;message:string;expiresAt:number}>('/auth/challenge', undefined, post({wallet:loginAddress}));
      if (!alive.current) return;
      if (!c.message.startsWith('InferPool buyer authentication\n') || !c.message.includes(`Domain: ${new URL(ROUTER_URL).host}\n`) || !c.message.includes(`Wallet: ${loginAddress}\n`) || !c.message.includes(`Nonce: ${c.nonce}\n`) || !Number.isFinite(c.expiresAt) || c.expiresAt <= Date.now() || c.expiresAt > Date.now() + 600000) throw new Error('钱包登录挑战与当前平台不匹配或已过期');
      const signature = await wallet.signMessage(c.message);
      if (!alive.current) return;
      const s = await api<{token:string;wallet:string}>('/auth/verify', undefined, post({wallet:loginAddress,nonce:c.nonce,signature}));
      if (!alive.current) return;
      if (s.wallet.toLowerCase() !== loginAddress || !s.token) throw new Error('登录会话与当前钱包不匹配');
      setSession({ ...s, wallet: loginAddress, id: crypto.randomUUID() });
    } catch (e) { if (alive.current) setError(messageOf(e)); }
    finally { busyRef.current = ''; if (alive.current) setBusy(''); }
  }
  async function run() {
    if (busyRef.current) return;
    if (!token) { await authenticate(); return; }
    let attempt = attemptRef.current;
    if (!attempt || attempt.ended) {
      if (!prompt.trim()) return setError('先写一点内容。');
      try { parseAmount(budget, 18, '单次 MON 预算'); } catch (reason) { return setError(messageOf(reason)); }
      if (!Number.isInteger(Number(maxTokens)) || Number(maxTokens) < 1 || Number(maxTokens) > 8192) return setError('最多输出必须是 1–8192 之间的整数。');
      attempt = { key: crypto.randomUUID(), ended: false, body: JSON.stringify({ model, messages:[{role:'user',content:prompt}], max_spend:budget, max_tokens:Number(maxTokens), ...(provider !== 'auto' ? {provider_id:provider} : {}), cache, stream:true }) };
      attemptRef.current = attempt;
      selectedOrder.current = null;
      setOrder(null);
    } else if (attempt.requestId) {
      selectedOrder.current = attempt.requestId;
      setOrder(snapshots.current.get(attempt.requestId) ?? null);
    }
    const { key: attemptKey, body: attemptBody } = attempt;
    // Polling and SSE may both finish this attempt; always consult the latest immutable snapshot.
    const currentAttempt = () => attemptRef.current?.key === attemptKey ? attemptRef.current : undefined;
    const updateAttempt = (patch: Partial<Pick<RequestAttempt, 'requestId' | 'ended'>>) => {
      const latest = currentAttempt();
      if (latest) attemptRef.current = { ...latest, ...patch };
    };
    const controller = new AbortController(); streamRef.current = controller;
    busyRef.current = 'request'; setBusy('request'); setError(''); setRetryRequest(false);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetch(ROUTER_URL + '/v1/chat/completions', { method: 'POST', body: attemptBody, signal: controller.signal, headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,'Idempotency-Key':attemptKey,'X-InferPool-Market':config.market_address} });
      if (!alive.current) return;
      if (!response.ok) {
        // These statuses are rejected before order creation. A transport/5xx failure is ambiguous.
        if (response.status >= 400 && response.status < 500 && !currentAttempt()?.requestId) updateAttempt({ ended: true });
        if (response.status === 401) expireSession(token);
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error?.message || `请求失败 (${response.status})`);
      }
      const headerId = response.headers.get('X-Request-Id');
      if (headerId) {
        const knownId = currentAttempt()?.requestId;
        if (knownId && knownId !== headerId) throw new Error('恢复请求返回了不同订单，请先查询账单。');
        updateAttempt({ requestId: headerId });
        if (!selectedOrder.current) selectedOrder.current = headerId;
      }
      if (!response.body) throw new Error('未收到流式响应；请在请求账单中查询结果。');
      reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
      const packet = (raw: string) => {
        const lines = raw.split(/\r?\n/);
        if (!lines.some(line => line === 'event: request')) return;
        const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data || !alive.current) return;
        const next = JSON.parse(data) as Snapshot;
        const knownId = currentAttempt()?.requestId;
        if (!next.id || next.buyer?.toLowerCase() !== address || (knownId && knownId !== next.id)) throw new Error('流式账单与当前请求不匹配。');
        updateAttempt({ requestId: next.id });
        if (!selectedOrder.current) selectedOrder.current = next.id;
        // A request snapshot already contains full output; chat deltas must not be appended twice.
        acceptOrder(next);
      };
      while (true) {
        const chunk = await reader.read(); buffer += decoder.decode(chunk.value, {stream:!chunk.done});
        if (!alive.current) return;
        const packets = buffer.split(/\r?\n\r?\n/); buffer = packets.pop() || '';
        for (const raw of packets) packet(raw);
        if (chunk.done) break;
      }
      if (buffer.trim()) packet(buffer);
      const latest = currentAttempt();
      if (latest && !latest.ended && latest.requestId) acceptOrder(await api<Order>(`/v1/requests/${latest.requestId}`, token, { signal: controller.signal }));
      if (!currentAttempt()?.ended) throw new Error('流式连接已结束，但请求最终状态尚未确认。');
      await refresh();
    } catch(e) {
      if (e instanceof ApiError && e.status === 401) expireSession(token);
      else if (alive.current && !controller.signal.aborted) setError(`${messageOf(e)} ${currentAttempt()?.ended ? '请查看账单中的结算状态。' : '断连不会取消订单；点击“恢复同一请求”将复用原订单，不会另开一次请求。'}`);
    } finally {
      await reader?.cancel().catch(() => {});
      if (streamRef.current === controller) streamRef.current = null;
      busyRef.current = '';
      if (alive.current) { setBusy(''); setRetryRequest(!currentAttempt()?.ended); }
    }
  }
  async function cancel() {
    if (!order || !token || !isRunning(order) || cancelRef.current) return;
    const id = order.id; cancelRef.current = id; setCancelling(id); setError('');
    try { acceptOrder(await api<Order>(`/v1/requests/${id}/cancel`, token, { ...post({}), headers: { 'X-InferPool-Market': config.market_address } })); await refresh(); }
    catch(e) {
      if (e instanceof ApiError && e.status === 401) expireSession(token);
      else if (alive.current) setError(`取消尚未确认：${messageOf(e)} 请查询该订单后重试取消。`);
    }
    finally { cancelRef.current = ''; if (alive.current) setCancelling(''); }
  }
  const nav = [{id:'play',label:'推理市场',icon:Layers3},{id:'bills',label:'请求账单',icon:Box},{id:'funds',label:'钱包与授权',icon:Wallet},{id:'api',label:'API 接入',icon:Braces},{id:'seller',label:'成为卖家',icon:Radio}];
  return <div className="app-shell">
    <aside className="sidebar"><Link className="brand" href="/"><span className="brand-symbol"><Layers3 size={23}/></span>inferpool<span className="brand-dot">.</span></Link><p className="sidebar-caption">AI 推理交易市场</p>
      <nav aria-label="主导航">{nav.map(n=><button key={n.id} className={`nav-item ${tab===n.id?'active':''}`} onClick={()=>setTab(n.id)} aria-current={tab===n.id?'page':undefined}><n.icon size={19}/>{n.label}{tab===n.id&&<span className="nav-marker"/>}</button>)}</nav>
      <div className="sidebar-bottom"><span className="network"><i/>{config.chain_id===10143?'Monad Testnet':'Local Anvil'}</span><p>模拟推理 · 真实测试链结算</p><a href={`https://testnet.monadscan.com/address/${config.market_address}`} target="_blank" rel="noreferrer">查看托管合约 <ArrowUpRight size={14}/></a></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumbs">工作台 <span>/</span> {nav.find(n=>n.id===tab)?.label}</div><div className="top-actions"><span className={`connection ${online?'live':''}`}><i/>{online?'Router 在线':'Router 未连接'}</span><button className="wallet-button" onClick={wallet.connect}><Wallet size={16}/>{wallet.address?short(wallet.address):'连接钱包'}</button></div></header>
    <main><div className="page-heading"><div><div className="eyebrow">INFERPOOL / {tab==='play'?'MARKETPLACE':tab.toUpperCase()}</div><h1>{nav.find(n=>n.id===tab)?.label}</h1><p>{tab==='play'?'选择一个节点，把推理的成本控制在预算之内。':tab==='bills'?'每次请求都有清晰的用量、费用和结算记录。':tab==='funds'?'余额由合约托管，你保留提款和撤销授权的权利。':tab==='api'?'一次授权，从你自己的程序发起请求。':'发布链上报价，运行节点，然后开始接单。'}</p></div><span className="demo-pill">HACKATHON DEMO <span>MOCK AI</span></span></div>
      {error&&<div className="error" role="alert">{error}<button aria-label="关闭提示" onClick={()=>setError('')}>×</button></div>}
      {!token&&wallet.address&&<div className="login-strip"><span>钱包已连接。签名登录后可查看账户与调用 API。</span><button className="button small" onClick={authenticate} disabled={!!busy}>{busy==='login'?'等待签名…':'签名登录'}<ArrowRight size={15}/></button></div>}
      {tab==='play'&&<>
        <div className="stats-row"><div><span>可用节点</span><strong>{online?sellers.length:'—'}<small>在线</small></strong></div><div><span>可用托管余额</span><strong>{account?money(account.available):'—'}<small>MON</small></strong></div><div><span>剩余消费授权</span><strong>{account?money(account.authorized):'—'}<small>MON</small></strong></div><div className="stat-rule"><ShieldCheck size={27}/><span>卖家故障<br/><b>整单推理费为零</b></span></div></div>
        <div className="section-label"><h2>选择推理节点 <span>{sellers.length.toString().padStart(2,'0')}</span></h2><span>单价 / 1M 模拟 Token · MON</span></div>
        <div className="seller-grid">{sellers.map((s,i)=><button key={s.provider_id} className={`seller-card ${provider===s.provider_id?'selected':''}`} disabled={busy==='request'||retryRequest} onClick={()=>{setProvider(s.provider_id);setModel(s.id);}}><div className="seller-top"><span className={`node-icon n${i%2}`}><Layers3 size={21}/></span><div><h3>{s.provider_name}</h3><p>{s.id}</p></div><span className="seller-status"><i/>{s.available_slots?'可接单':'忙碌'}</span></div><div className="card-prices"><div><span>普通输入</span><b>{money(s.quote.input)}</b></div><div><span>输出</span><b>{money(s.quote.output)}</b></div></div><div className="cache-price"><span>缓存读 {money(s.quote.cacheRead)}</span><span>缓存写 {money(s.quote.cacheWrite)}</span></div><div className="seller-footer"><span>最低预留 {money(s.quote.minReserve)} MON</span><span>{provider===s.provider_id?<Check size={17}/>:<ArrowUpRight size={17}/>}</span></div></button>)}{!sellers.length&&<div className="empty panel"><Radio/><h3>{online?'暂时没有在线节点':'正在连接推理市场'}</h3><p>卖家运行节点并发布报价后，会出现在这里。</p><button className="text-button" onClick={()=>void refreshPublic()}>刷新节点</button></div>}</div>
        <div className="workspace-grid"><section className="panel playground"><div className="panel-title"><h2><Terminal size={18}/> 在线体验台</h2><span className="subtle-pill">流式响应</span></div><div className="request-options"><label className="field">节点<select value={provider} onChange={e=>setProvider(e.target.value)} disabled={busy==='request'||retryRequest}><option value="auto">自动匹配 · 估算总价最低</option>{sellers.filter(s=>s.id===model).map(s=><option key={s.provider_id} value={s.provider_id}>{s.provider_name}</option>)}</select></label><label className="field">本次预算 · MON<input inputMode="decimal" value={budget} onChange={e=>setBudget(e.target.value)} disabled={busy==='request'||retryRequest}/></label><label className="field">最多输出<input type="number" min={1} max={8192} value={maxTokens} onChange={e=>setMaxTokens(e.target.value)} disabled={busy==='request'||retryRequest}/></label></div>
          <label className="field prompt-label">输入内容<textarea value={prompt} onChange={e=>setPrompt(e.target.value)} rows={4} disabled={busy==='request'||retryRequest} placeholder="向模型发送一条消息…"/></label><div className="request-toolbar"><label className="check-label"><input type="checkbox" checked={cache} onChange={e=>setCache(e.target.checked)} disabled={busy==='request'||retryRequest}/> 模拟上下文缓存</label><button className="button" onClick={run} disabled={!!busy||!online||(!retryRequest&&!sellers.length)}>{busy==='request'?<LoaderCircle className="spin" size={17}/>:<Play size={16}/>} {busy==='request'?'请求处理中':retryRequest?'恢复同一请求':token?'运行请求':'登录后运行'}</button></div>
          <div className="output-window"><div className="output-heading"><span><i className={isRunning(order)?'pulsing':''}/>{order?statuses[order.status]:waitingForBudget?'正在提交与确认预算':'等待请求'}</span>{isRunning(order)&&<button className="text-button danger" onClick={cancel} disabled={cancelling===order?.id}><CircleStop size={15}/> {cancelling===order?.id?'取消中…':'取消请求'}</button>}</div><div className="output-text" aria-live="polite">{order?.output||<div className="output-empty"><Terminal size={28}/><span>{waitingForBudget?'正在提交请求并确认链上预算':'响应将逐步显示在这里'}</span><small>锁款确认后，卖家才会开始输出</small></div>}</div></div><p className="fine-print">Mock 使用 Unicode 字符模拟 Token，不代表真实模型能力。平台与接单卖家可见请求内容。</p></section>
          <Bill key={order?.id??'empty'} order={order} config={config} wallet={wallet} onRefresh={refresh}/></div>
      </>}
      {tab==='bills'&&<div className="billing-layout"><section className="panel"><div className="panel-title"><h2>最近请求</h2><button className="text-button" onClick={()=>void refresh()}><RefreshCw size={15}/>刷新</button></div>{!token?<div className="empty"><Wallet/><p>连接钱包并签名登录后查看你的请求。</p><button className="button" onClick={authenticate}>登录</button></div>:!orders.length?<div className="empty">还没有请求。去体验台开始第一次推理。</div>:<div className="table-wrap"><table><thead><tr><th>请求 / 节点</th><th>状态</th><th>费用 / 资产</th><th>结算</th></tr></thead><tbody>{orders.map(o=><tr key={o.id} onClick={()=>selectOrder(o)}><td><button className="text-button">{o.id.slice(0,8)}</button><small>{o.providerId}</small></td><td>{statuses[o.status]}</td><td>{o.billConfirmed?money(o.charge):'待确认'} <small>{orderAsset(o,config).symbol}</small></td><td><span className={o.billConfirmed?'tag-good':'muted'}>{settlementLabel(o)}</span></td></tr>)}</tbody></table></div>}</section><Bill key={order?.id??'empty'} order={order} config={config} wallet={wallet} onRefresh={refresh}/></div>}
      {tab==='funds'&&<AccountPanel wallet={wallet} config={config} account={account} onRefresh={refresh}/>}
      {tab==='seller'&&<SellerPanel wallet={wallet} config={config} onRefresh={refresh}/>}
      {tab==='api'&&<ApiPanel key={session?.id??'logged-out'} token={token} onLogin={authenticate} config={config} onSessionExpired={expireSession}/>}
      <footer><span>InferPool · Monad Testnet Hackathon</span><span>测试资产无现金价值 · 计量与判责由平台负责</span></footer>
    </main></div>
  </div>;
}
function Bill({order:o,config,wallet,onRefresh}:{order:Order|null;config:MarketConfig;wallet:WalletAccess;onRefresh:()=>Promise<void>}) {
  const [status,setStatus]=useState(''); const [working,setWorking]=useState(false); const [reclaimed,setReclaimed]=useState(false); const [expired,setExpired]=useState(false);
  const alive=useRef(true); const inFlight=useRef(false);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const deadline=o?.deadline;
  useEffect(()=>{
    if(deadline===undefined)return;
    const id=setTimeout(()=>setExpired(true),Math.max(0,deadline*1000-Date.now()));
    return()=>clearTimeout(id);
  },[deadline]);
  const link = o?.settlementTx && txUrl(o.settlementTx,config.chain_id);
  const asset = o ? orderAsset(o, config) : { symbol: config.asset_symbol, target: undefined, market: undefined };
  async function reclaim() {
    if (!o || !asset.target || inFlight.current || reclaimed || o.buyer.toLowerCase()!==wallet.address?.toLowerCase()) return;
    inFlight.current=true; setWorking(true); setStatus('');
    try {
      await wallet.sendContract(asset.target,'reclaimExpired',[keccak256(stringToHex(o.id))]);
      if (!alive.current) return;
      setReclaimed(true); setStatus('超时资金已在链上释放，正在刷新账单。');
      await onRefresh();
    } catch(e) { if(alive.current)setStatus(messageOf(e)); }
    finally { inFlight.current=false; if(alive.current)setWorking(false); }
  }
  return <aside className="panel bill"><div className="panel-title"><h2>本次账单</h2><span className={`subtle-pill ${o?.billConfirmed?'good':''}`}>{o?.billConfirmed?'链上已确认':'预计 / 待确认'}</span></div><div className="bill-total"><span>{o?.billConfirmed?'实际费用':'结算后显示实际费用'}</span><strong>{o?.billConfirmed?money(o.charge):'—'}<small>{asset.symbol}</small></strong></div><div className="bill-line"><span>预算预留</span><b>{o?money(o.budget):'—'}</b></div><div className="bill-line"><span>{o?.billConfirmed?'已释放预算':'待释放预算'}</span><b className="green">{o?money(o.released):'—'}</b></div><div className="bill-breakdown"><div className="breakdown-heading"><span>计量明细</span><span>模拟 Token</span></div>{(Object.keys(priceLabels) as PriceKey[]).map(k=><div className="bill-line" key={k}><span>{k==='output'?<ArrowUpRight size={14}/>:<ArrowDownLeft size={14}/>} {priceLabels[k]}</span><b>{o?o.usage[k].toLocaleString():'—'}</b></div>)}</div><div className="bill-info"><ShieldCheck size={18}/><p>只收实际用量费用。<br/>卖家故障时，整单推理费为零。</p></div>{o&&<div className="bill-meta"><p>资产 {asset.symbol}</p><p>托管合约 <code>{asset.market ?? '待核对，已禁用直接回收'}</code></p><p>请求 <code>{o.id}</code></p><p>卖家 <code>{short(o.seller)}</code></p><p>报价版本 {o.quote.version||'—'} · 缓存 {o.cacheMode}</p><p>{statuses[o.status]}</p>{o.settlementError&&<p className="error">结算待处理：{o.settlementError}</p>}{link&&<a className="text-button green" target="_blank" rel="noreferrer" href={link}>查看结算交易 <ArrowUpRight size={15}/></a>}{o.lockTx&&txUrl(o.lockTx,config.chain_id)&&<a className="text-button" target="_blank" rel="noreferrer" href={txUrl(o.lockTx,config.chain_id)}>查看锁款交易 <ArrowUpRight size={15}/></a>}{asset.target&&!o.billConfirmed&&o.lockTx&&o.status!=='lock_failed'&&!reclaimed&&expired&&<button className="button secondary" disabled={working} onClick={reclaim}>直接取回超时锁款</button>}{status&&<p role="status">{status}</p>}</div>}</aside>;
}
function ApiPanel({token,onLogin,config,onSessionExpired}:{token?:string;onLogin:()=>Promise<void>;config:MarketConfig;onSessionExpired:(token:string)=>void}) {
  const [keys,setKeys]=useState<ApiKeyInfo[]>([]);
  const [newKey,setNewKey]=useState('');const [name,setName]=useState('我的应用');const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
  const reportError=useCallback((error:unknown)=>{
    if(error instanceof ApiError&&error.status===401&&token)onSessionExpired(token);
    else setMessage(messageOf(error));
  },[token,onSessionExpired]);
  const alive=useRef(true); const inFlight=useRef(false); const loadSequence=useRef(0); const lifecycle=useRef<AbortController|null>(null);
  useEffect(()=>{
    alive.current=true;
    let scope=new AbortController(); lifecycle.current=scope;
    const hide=()=>{alive.current=false;scope.abort();inFlight.current=false;setNewKey('');setBusy(false);};
    const show=()=>{if(scope.signal.aborted){scope=new AbortController();lifecycle.current=scope;}alive.current=true;};
    window.addEventListener('pagehide',hide); window.addEventListener('pageshow',show);
    return()=>{alive.current=false;scope.abort();window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',show);};
  },[]);
  const load=useCallback(async()=>{
    const scope=lifecycle.current;
    if(!token||!alive.current||!scope||scope.signal.aborted)return;
    const sequence=++loadSequence.current;
    const list=await api<{data:ApiKeyInfo[]}>('/api-keys',token,{signal:scope.signal});
    if(alive.current&&!scope.signal.aborted&&scope===lifecycle.current&&sequence===loadSequence.current)setKeys(list.data);
  },[token]);
  useEffect(()=>{const scope=lifecycle.current;void load().catch(e=>{if(alive.current&&scope&&!scope.signal.aborted&&scope===lifecycle.current)reportError(e);});},[load,reportError]);
  async function create(){
    const scope=lifecycle.current;
    if(!token||inFlight.current||!name.trim()||!alive.current||!scope||scope.signal.aborted)return;
    const current=()=>alive.current&&!scope.signal.aborted&&scope===lifecycle.current;
    inFlight.current=true;setBusy(true);setMessage('');setNewKey('');
    try{
      const k=await api<{token:string}>('/api-keys',token,post({name:name.trim(),expires_in_days:7}));
      if(!current())return;
      setNewKey(k.token);
      try{await load();}catch(e){if(current()){if(e instanceof ApiError&&e.status===401)reportError(e);else setMessage('Key 已生成。列表暂时无法刷新，请先保存上方 Key。');}}
    }catch(e){if(current())reportError(e);}
    finally{if(scope===lifecycle.current)inFlight.current=false;if(current())setBusy(false);}
  }
  async function revoke(id:string){
    const scope=lifecycle.current;
    if(!token||inFlight.current||!alive.current||!scope||scope.signal.aborted)return;
    const current=()=>alive.current&&!scope.signal.aborted&&scope===lifecycle.current;
    inFlight.current=true;setBusy(true);setMessage('');
    try{
      await api(`/api-keys/${id}`,token,{method:'DELETE'});
      if(!current())return;
      setNewKey('');setMessage('API Key 已撤销。');
      try{await load();}catch(e){if(current()){if(e instanceof ApiError&&e.status===401)reportError(e);else setMessage('API Key 已撤销，列表刷新暂时失败。');}}
    }catch(e){if(current())reportError(e);}
    finally{if(scope===lifecycle.current)inFlight.current=false;if(current())setBusy(false);}
  }
  async function copy(value:string,label:string){
    const scope=lifecycle.current;
    if(!alive.current||!scope||scope.signal.aborted)return;
    const current=()=>alive.current&&!scope.signal.aborted&&scope===lifecycle.current;
    try{await navigator.clipboard.writeText(value);if(current())setMessage(`已复制${label}`);}
    catch{if(current())setMessage('复制失败，请手动选择并保存。');}
  }
  function keyScope(key: ApiKeyInfo) {
    const market = key.market_address?.toLowerCase();
    if (market === config.market_address.toLowerCase()) return 'MON · 当前市场';
    return '市场待核对 · 不可用';
  }
  const example=`curl ${ROUTER_URL}/v1/chat/completions \\\n  -H "Authorization: Bearer $INFERPOOL_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -H "Idempotency-Key: your-unique-request-id" \\\n  -d '{\n    "model": "mock-reasoner",\n    "messages": [{"role":"user","content":"你好"}],\n    "max_spend": "0.001",\n    "max_tokens": 512,\n    "stream": true,\n    "cache": false\n  }'`;
  return <div className="api-grid"><section className="panel"><div className="panel-title"><h2>API Key</h2><span className="subtle-pill">只展示一次</span></div><p className="muted">先在「钱包与授权」设置 MON 消费额度，再通过钱包会话新建 MON API Key。Key 仅适用于当前市场，不能提款或扩大授权。</p>{!token?<button className="button" onClick={onLogin}>连接并签名登录</button>:<><label className="field">应用名称<input value={name} onChange={e=>setName(e.target.value)} maxLength={80}/></label><button className="button" onClick={create} disabled={busy||!name.trim()}>生成 MON API Key</button>{newKey&&<div className="secret-box"><p>请立即保存，离开此页面后无法再次查看。</p><code>{newKey}</code><button className="text-button" onClick={()=>void copy(newKey,' API Key')}><Copy size={15}/>复制</button></div>}<div className="key-list">{keys.map(k=><div className="key-item" key={k.id}><div><b>{k.name}</b><small>{keyScope(k)}</small><code>{k.preview}</code><small>{k.revokedAt?'已撤销':`有效至 ${new Date(k.expiresAt).toLocaleDateString('zh-CN')}`}</small></div>{!k.revokedAt&&<button className="text-button danger" disabled={busy} onClick={()=>void revoke(k.id)}>撤销</button>}</div>)}</div></>}{message&&<p role="status" className="muted">{message}</p>}</section><section className="panel api-code"><div className="panel-title"><h2><Braces size={18}/> 发起请求</h2><button className="text-button" onClick={()=>void copy(example,'示例')}><Copy size={15}/>复制</button></div><pre>{example}</pre><div className="api-notes"><p><b>基础聊天接口</b> 支持文本消息、流式输出、预算和指定卖家。</p><p><b>断线恢复</b> 用响应的 X-Request-Id 查询 /v1/requests/{'{id}'}。关闭连接不会取消请求。</p><p><b>显式取消</b> POST /v1/requests/{'{id}'}/cancel，按取消生效前的实际用量结算。</p><p><b>金额</b> 以 MON 为单位，使用最多 18 位小数的字符串；所有 Key 共用账户的链上消费限额。</p></div></section></div>;
}
