'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPublicClient, formatEther, formatUnits, http, keccak256, parseUnits, stringToHex, type Hex } from 'viem';
import { short, txUrl } from '../lib/api';
import { chainFor, marketAbi, rpcFor, tokenAbi } from '../lib/contracts';
import type { AccountInfo, MarketConfig, WalletAccess } from '../lib/types';

interface AccountPanelProps {
  wallet: WalletAccess;
  config: MarketConfig;
  account: AccountInfo | null;
  onRefresh: () => Promise<void>;
}

interface WalletFunds { owner: string; balance: bigint; escrowBalance: bigint; nativeBalance: bigint; claimed: boolean }
interface ConfirmedTransaction { label: string; hash: Hex }
interface RecoverableOrder { buyer: string; reserved: bigint; deadline: bigint; state: number }
interface RecoverySnapshot { owner: string; requestId: Hex; reserved: bigint; deadline: bigint; state: number }

function amount(value: string, label: string): bigint {
  if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value.trim())) throw new Error(`${label}请输入正数，最多保留 6 位小数。`);
  const parsed = parseUnits(value.trim(), 6);
  if (parsed <= 0n || parsed > 2n ** 256n - 1n) throw new Error(`${label}必须大于 0，且在合约支持的范围内。`);
  return parsed;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return '操作未完成，请检查钱包提示后重试。';
}

function recoveryId(value: string): Hex {
  const id = value.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(id)) return id as Hex;
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id)) {
    return keccak256(stringToHex(id.toLowerCase()));
  }
  throw new Error('请输入账单中的完整请求 UUID，或以 0x 开头的 64 位链上订单 ID。');
}

export function AccountPanel({ wallet, config, account, onRefresh }: AccountPanelProps) {
  const client = useMemo(() => createPublicClient({ chain: chainFor(config.chain_id), transport: http(rpcFor(config.chain_id)) }), [config.chain_id]);
  const [funds, setFunds] = useState<WalletFunds | null>(null);
  const [depositAmount, setDepositAmount] = useState('10');
  const [grantAmount, setGrantAmount] = useState('5');
  const [grantHours, setGrantHours] = useState('24');
  const [withdrawAmount, setWithdrawAmount] = useState('1');
  const [recoveryInput, setRecoveryInput] = useState('');
  const [recoveryOrder, setRecoveryOrder] = useState<RecoverySnapshot | null>(null);
  const [pending, setPending] = useState('');
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const [transactions, setTransactions] = useState<ConfirmedTransaction[]>([]);
  const busy = useRef(false);
  const ownerKey = `${config.chain_id}:${config.market_address}:${config.token_address}:${wallet.address ?? ''}`;
  const currentOwner = useRef(ownerKey);
  const currentAddress = useRef(wallet.address);
  useEffect(() => { currentAddress.current = wallet.address; currentOwner.current = ownerKey; }, [wallet.address, ownerKey]);

  const refreshFunds = useCallback(async () => {
    const address = wallet.address;
    if (!address) return;
    const [balance, claimed, nativeBalance, escrowBalance] = await Promise.all([
      client.readContract({ address: config.token_address, abi: tokenAbi, functionName: 'balanceOf', args: [address] }),
      client.readContract({ address: config.token_address, abi: tokenAbi, functionName: 'hasClaimed', args: [address] }),
      client.getBalance({ address }),
      client.readContract({ address: config.market_address, abi: marketAbi, functionName: 'balances', args: [address] }),
    ]);
    if (currentOwner.current !== ownerKey) return;
    setFunds({ owner: ownerKey, balance: balance as bigint, escrowBalance: escrowBalance as bigint, claimed: claimed as boolean, nativeBalance });
    setReadError('');
  }, [client, config.market_address, config.token_address, ownerKey, wallet.address]);

  useEffect(() => {
    let active = true;
    void refreshFunds().catch(() => {
      if (active) setReadError('链上余额暂时无法读取，请稍后刷新。');
    });
    return () => { active = false; };
  }, [refreshFunds]);

  const displayedFunds = funds?.owner === ownerKey ? funds : null;
  const displayedAccount = account?.wallet.toLowerCase() === wallet.address?.toLowerCase() ? account : null;
  const displayedRecovery = recoveryOrder?.owner === ownerKey ? recoveryOrder : null;
  const disabled = !wallet.address || Boolean(pending);

  async function confirm(target: 'market' | 'token', functionName: string, args: readonly unknown[], label: string) {
    const hash = await wallet.sendContract(target, functionName, args);
    setTransactions((previous) => [...previous, { label, hash }]);
    return hash;
  }

  async function run(label: string, action: () => Promise<string>, refreshRouter = true) {
    if (busy.current || !wallet.address) return;
    busy.current = true;
    setPending(label);
    setError('');
    setSuccess('');
    setTransactions([]);
    try {
      const result = await action();
      setSuccess(result);
      const updates = await Promise.allSettled([refreshFunds(), ...(refreshRouter ? [onRefresh()] : [])]);
      if (updates.some((update) => update.status === 'rejected')) setReadError('交易已确认，部分余额暂未刷新。请稍后点击刷新余额。');
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setPending('');
      busy.current = false;
    }
  }

  const expiry = displayedAccount?.authorizationExpiresAt
    ? new Date(displayedAccount.authorizationExpiresAt * 1000).toLocaleString('zh-CN', { hour12: false })
    : '尚未授权';

  return (
    <section className="panel account-panel" aria-labelledby="account-title" aria-busy={Boolean(pending)}>
      <div className="panel-heading">
        <div><p className="eyebrow">TEST ASSET ACCOUNT</p><h2 id="account-title">账户与消费授权</h2></div>
        <button className="button secondary" type="button" disabled={disabled} onClick={() => void run('正在刷新余额…', async () => '账户数据已刷新。')}>刷新余额</button>
      </div>
      <p className="muted">dUSD 是没有现实价值的演示资产。领取、存款、授权和提款需支付少量测试 MON Gas；平台承担请求锁款与结算的 Gas。</p>
      {!wallet.address && <button className="button" type="button" onClick={wallet.connect}>连接钱包管理账户</button>}
      <div className="form-grid account-summary">
        <div className="field"><span className="muted">钱包 dUSD</span><strong>{displayedFunds ? formatUnits(displayedFunds.balance, 6) : '—'}</strong></div>
        <div className="field"><span className="muted">可用托管余额</span><strong>{displayedFunds ? formatUnits(displayedFunds.escrowBalance, 6) : displayedAccount?.available ?? '—'} dUSD</strong></div>
        <div className="field"><span className="muted">当前授权可用额度</span><strong>{displayedAccount?.authorized ?? '—'} dUSD</strong></div>
        <div className="field"><span className="muted">测试 MON</span><strong>{displayedFunds ? formatEther(displayedFunds.nativeBalance) : '—'}</strong></div>
      </div>
      <p className="muted">授权到期：{expiry}</p>
      {displayedFunds?.nativeBalance === 0n && <p className="error" role="status">钱包暂时没有测试 MON，请先补充 Gas 再发起交易。</p>}
      <div className="faucet-row">
        <button className="button secondary" type="button" disabled={disabled || !displayedFunds || displayedFunds.claimed} onClick={() => void run('正在领取测试资产…', async () => {
          await confirm('token', 'faucet', [], '领取测试 dUSD');
          return '已领取 1,000 dUSD。存入托管合约后即可用于模拟推理。';
        })}>{displayedFunds?.claimed ? '此钱包已领取 1,000 dUSD' : '领取 1,000 测试 dUSD'}</button>
        <span className="muted">每个钱包只能领取一次。</span>
      </div>
      <div className="form-grid">
        <form onSubmit={(event) => { event.preventDefault(); void run('等待批准存款额度…', async () => {
          const units = amount(depositAmount, '存款金额');
          if (displayedFunds && units > displayedFunds.balance) throw new Error('存款金额超过钱包 dUSD 余额。');
          const startedAddress = wallet.address;
          await confirm('token', 'approve', [config.market_address, units], '批准本次存款额度');
          if (currentAddress.current !== startedAddress) throw new Error('批准已完成，但钱包地址已切换。请切回原钱包后继续存款。');
          setPending('存款额度已批准，等待存款确认…');
          try { await confirm('market', 'deposit', [units], '存入托管合约'); }
          catch (reason) { throw new Error(`代币批准已完成，存款未完成：${errorMessage(reason)}`); }
          return `已存入 ${formatUnits(units, 6)} dUSD。`;
        }); }}>
          <fieldset disabled={disabled}>
            <legend>1. 存入测试资产</legend>
            <label className="field" htmlFor="account-deposit">存款金额（dUSD）<input id="account-deposit" inputMode="decimal" autoComplete="off" value={depositAmount} onChange={(event) => setDepositAmount(event.target.value)} required /></label>
            <p className="muted">两次钱包确认：批准精确金额，再存入合约。</p>
            <button className="button" type="submit">批准并存款</button>
          </fieldset>
        </form>
        <form onSubmit={(event) => { event.preventDefault(); void run('等待消费授权确认…', async () => {
          const units = amount(grantAmount, '授权总额');
          if (!/^\d+$/.test(grantHours) || Number(grantHours) < 1 || Number(grantHours) > 24) throw new Error('有效期请输入 1 至 24 之间的整数小时。');
          const expirySeconds = BigInt(Math.floor(Date.now() / 1000) + Number(grantHours) * 3600);
          await confirm('market', 'authorizeRouter', [units, expirySeconds], '创建消费授权');
          return `已授权 ${formatUnits(units, 6)} dUSD，有效 ${grantHours} 小时。API Key 无权提款。`;
        }); }}>
          <fieldset disabled={disabled}>
            <legend>2. 设置消费上限</legend>
            <label className="field" htmlFor="account-grant">本次授权总额（dUSD）<input id="account-grant" inputMode="decimal" autoComplete="off" value={grantAmount} onChange={(event) => setGrantAmount(event.target.value)} required /></label>
            <label className="field" htmlFor="account-grant-hours">有效期（小时）<input id="account-grant-hours" type="number" min="1" max="24" step="1" value={grantHours} onChange={(event) => setGrantHours(event.target.value)} required /></label>
            <p className="muted">新授权提供一笔新的消费额度，替换新请求所用授权；旧订单仍按原授权结算。</p>
            <button className="button" type="submit">授权平台消费</button>
          </fieldset>
        </form>
        <form onSubmit={(event) => { event.preventDefault(); void run('等待提款确认…', async () => {
          const units = amount(withdrawAmount, '提款金额');
          const startedAddress = wallet.address;
          if (!startedAddress) throw new Error('请先连接钱包。');
          const available = await client.readContract({ address: config.market_address, abi: marketAbi, functionName: 'balances', args: [startedAddress] }) as bigint;
          if (currentOwner.current !== ownerKey) throw new Error('钱包或网络已切换，请重新发起提款。');
          if (units > available) throw new Error('提款金额超过可用托管余额，进行中的订单锁款暂不可提取。');
          await confirm('market', 'withdraw', [units], '提款至当前钱包');
          return `已将 ${formatUnits(units, 6)} dUSD 提回钱包。`;
        }, false); }}>
          <fieldset disabled={disabled}>
            <legend>提回可用余额</legend>
            <label className="field" htmlFor="account-withdraw">提款金额（dUSD）<input id="account-withdraw" inputMode="decimal" autoComplete="off" value={withdrawAmount} onChange={(event) => setWithdrawAmount(event.target.value)} required /></label>
            <p className="muted">只能由当前钱包提取自己的可用余额。</p>
            <button className="button secondary" type="submit">提款</button>
          </fieldset>
        </form>
      </div>
      <div className="revoke-row">
        <button className="button secondary" type="button" disabled={disabled || !displayedAccount?.authorizationExpiresAt} onClick={() => void run('等待撤销消费授权…', async () => {
          await confirm('market', 'revokeRouter', [], '撤销当前消费授权');
          return '已撤销消费授权，新请求无法继续锁款；现有订单仍在原预算内结算。';
        })}>撤销消费授权</button>
        <p className="muted">撤销授权不会取消已锁款订单，也不会自动提款。</p>
      </div>
      <form className="offline-recovery" onSubmit={(event) => { event.preventDefault(); void run('正在通过链上数据检查超时订单…', async () => {
        const startedAddress = wallet.address;
        if (!startedAddress) throw new Error('请先连接订单对应的买家钱包。');
        const requestId = recoveryId(recoveryInput);
        const block = await client.getBlock({ blockTag: 'latest' });
        const order = await client.readContract({
          address: config.market_address, abi: marketAbi, functionName: 'getOrder', args: [requestId], blockNumber: block.number,
        }) as unknown as RecoverableOrder;
        if (currentOwner.current !== ownerKey || currentAddress.current !== startedAddress) throw new Error('钱包或网络已切换，请重新检查订单。');
        if (order.state === 0) throw new Error('当前网络和市场合约中没有找到此订单，请核对请求 ID。');
        if (order.buyer.toLowerCase() !== startedAddress.toLowerCase()) throw new Error('此订单不属于当前钱包，请连接原买家钱包。');
        setRecoveryOrder({ owner: ownerKey, requestId, reserved: order.reserved, deadline: order.deadline, state: order.state });
        if (order.state === 2) throw new Error('此订单已结算，没有可重复取回的锁款。');
        if (order.state === 3) throw new Error('此订单已取回，释放金额已计入可用托管余额。');
        if (order.state !== 1) throw new Error('此订单当前不处于可回收的锁款状态。');
        if (block.timestamp < order.deadline) {
          throw new Error(`订单尚未到期，按链上时间还需等待 ${order.deadline - block.timestamp} 秒。请到期后再次尝试。`);
        }
        setPending('订单已到期，等待钱包确认取回锁款…');
        await confirm('market', 'reclaimExpired', [requestId], '直接取回超时锁款');
        setRecoveryOrder({ owner: ownerKey, requestId, reserved: order.reserved, deadline: order.deadline, state: 3 });
        return `已直接从合约释放 ${formatUnits(order.reserved, 6)} dUSD 至可用托管余额，可继续使用上方提款功能提回钱包。`;
      }, false); }}>
        <fieldset disabled={disabled}>
          <legend>平台离线时取回锁款</legend>
          <p className="muted">保存账单中的请求 ID。即使平台无法访问，也可连接原买家钱包，在订单到期后直接通过链上合约取回锁款；无需平台登录。</p>
          <label className="field" htmlFor="account-recovery-id">请求 UUID 或链上订单 ID<input id="account-recovery-id" autoComplete="off" spellCheck={false} placeholder="粘贴完整请求 UUID 或 0x 开头的订单 ID" value={recoveryInput} onChange={(event) => { setRecoveryInput(event.target.value); setRecoveryOrder(null); }} required /></label>
          <button className="button secondary" type="submit">检查并取回超时锁款</button>
          <p className="muted">以链上区块时间判断是否到期。回收交易需支付少量测试 MON Gas，释放后的资金先回到托管余额。</p>
        </fieldset>
        {displayedRecovery && <p className="muted">已核对订单 <code>{short(displayedRecovery.requestId)}</code> · 原锁款 {formatUnits(displayedRecovery.reserved, 6)} dUSD · {displayedRecovery.state === 3 ? '已取回' : displayedRecovery.state === 2 ? '已结算' : '等待到期回收'}</p>}
      </form>
      {pending && <p className="muted" role="status">{pending}</p>}
      {success && <p className="success" role="status">{success}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {readError && <p className="muted" role="status">{readError}</p>}
      {transactions.length > 0 && <ul className="transaction-list">{transactions.map(({ hash, label }) => <li key={hash}>{label} · {txUrl(hash, config.chain_id) ? <a href={txUrl(hash, config.chain_id)} target="_blank" rel="noreferrer">{short(hash)} ↗</a> : <code>{short(hash)}</code>}</li>)}</ul>}
    </section>
  );
}

export default AccountPanel;
