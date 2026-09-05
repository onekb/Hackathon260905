const $ = (id) => document.getElementById(id);
const token = document.querySelector('meta[name="provider-control"]').content;
const modes = {
  normal: ['正常完成', '正常输出 Mock 内容，由平台按实际模拟用量结算。'],
  timeout: ['接单后超时', '节点保持在线但不输出，等待平台超时判定。卖家故障整单推理费为零。'],
  'fail-before': ['首个输出前失败', '接单后报告模拟错误，不输出正文；整单推理费为零。'],
  'fail-mid': ['输出中途失败', '先输出部分内容再报告模拟错误；已经输出的部分也不收费。'],
  'cache-hit': ['缓存演示', '首次成功请求写入模拟缓存，相同买家、模型、卖家和完整上下文再次请求时才命中。'],
};
const statuses = { offline: '已下线', connecting: '连接中', authenticating: '钱包认证中', online: '在线接单', reconnecting: '等待重连' };
const results = { running: '执行中', completed: '完成', failed: '卖家失败', cancelled: '已停止', disconnected: '节点断连' };
let state;
let pricingDirty = false;
let busy = false;
let flash = '';

function text(id, value) { $(id).textContent = value; }
function showError(message) { text('error', message || ''); $('error').hidden = !message; }

function render(next) {
  state = next;
  text('name', next.name); text('provider-id', next.providerId); text('model', next.modelId);
  text('status', statuses[next.status] || next.status); $('status-dot').className = next.status;
  text('active', next.active); text('capacity', next.capacity); text('slots', `${next.availableSlots} 个空闲并发`);
  text('speed', Math.round(next.chunkSize * 1000 / next.intervalMs));
  text('router', next.router); text('wallet', next.wallet);
  text('wallet-mode', next.walletMode === 'alchemy-session' ? 'Alchemy session · 委托消息签名' : next.ephemeralWallet ? '临时演示钱包 · 重启后更换' : '本地环境变量钱包');
  text('toggle', next.enabled ? '下线节点' : '上线节点');
  $('toggle').classList.toggle('danger', next.enabled);
  if (document.activeElement !== $('mode')) $('mode').value = next.mode;
  text('mode-hint', modes[next.mode]?.[1] || '');
  if (!pricingDirty) for (const [key, value] of Object.entries(next.pricing)) $('pricing').elements.namedItem(key).value = value;
  const effective = next.effectivePricing;
  $('effective-values').hidden = !effective;
  if (effective) {
    text('effective-input', effective.input); text('effective-cache-read', effective.cacheRead);
    text('effective-cache-write', effective.cacheWrite); text('effective-output', effective.output);
    text('effective-min-reserve', `${effective.minReserve} DemoUSD`);
    text('effective-status', `${next.status === 'online' ? '连接时确认' : '最近一次连接记录'}：${new Date(next.effectivePricingVerifiedAt).toLocaleTimeString('zh-CN')}${effective.version ? ` · 版本 ${effective.version}` : ''}。每单仍由平台读取链上有效报价。`);
    text('pricing-match', next.pricingMatchesEffective ? '本地配置与上述报价一致。' : '本地配置与上述报价不同；本地修改尚未通过链上发布生效。');
  } else {
    text('effective-status', '尚未取得平台确认的链上报价。请先用该钱包为此模型发布链上报价，再连接平台。');
    text('pricing-match', '上方数值仅为本地配置，不代表可用的市场报价。');
  }
  $('save-pricing').disabled = busy || next.active > 0;
  showError(flash || next.lastError);
  const body = $('requests'); body.replaceChildren();
  text('history-count', `${next.requests.length} 个请求`);
  if (!next.requests.length) {
    const row = body.insertRow(); const cell = row.insertCell(); cell.colSpan = 5; cell.className = 'empty'; cell.textContent = '节点上线后，在买家体验台发起请求。';
  }
  for (const run of next.requests) {
    const row = body.insertRow();
    const first = row.insertCell(); const id = document.createElement('code'); id.textContent = run.requestId.slice(0, 22); id.title = run.requestId; first.append(id);
    const time = document.createElement('small'); time.textContent = new Date(run.startedAt).toLocaleTimeString('zh-CN'); first.append(time);
    row.insertCell().textContent = modes[run.mode]?.[0] || run.mode;
    row.insertCell().textContent = ({ none: '无缓存', read: '读取', write: '写入' })[run.cache];
    row.insertCell().textContent = run.outputTokens;
    const badge = document.createElement('span'); badge.className = `badge ${run.status}`; badge.textContent = results[run.status] || run.status; row.insertCell().append(badge);
  }
}

async function control(path, payload = {}) {
  if (busy) return;
  busy = true; flash = '';
  try {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Provider-Control': token }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '操作失败');
    render(result);
  } catch (error) { flash = error.message; showError(flash); }
  finally { busy = false; if (state) $('save-pricing').disabled = state.active > 0; }
}

$('toggle').addEventListener('click', () => control(state?.enabled ? '/api/offline' : '/api/online'));
$('mode').addEventListener('change', (event) => control('/api/mode', { mode: event.target.value }));
$('pricing').addEventListener('input', () => { pricingDirty = true; });
$('pricing').addEventListener('submit', async (event) => {
  event.preventDefault();
  const pricing = Object.fromEntries(new FormData(event.currentTarget));
  await control('/api/pricing', { pricing });
  if (!flash) pricingDirty = false;
});

async function poll() {
  try {
    const response = await fetch('/api/state');
    if (!response.ok) throw new Error('状态读取失败');
    if (!busy) render(await response.json());
  } catch { showError('本地节点已停止或无法连接，请在终端重新启动。'); }
  finally { setTimeout(poll, 1000); }
}
void poll();
