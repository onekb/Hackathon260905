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
let browserLink = null;
let browserReset = Promise.resolve();
let stateEpoch = 0;

function text(id, value) { $(id).textContent = value; }
function showError(message) { text('error', message || ''); $('error').hidden = !message; }

function render(next) {
  state = next;
  text('name', next.name); text('provider-id', next.providerId); text('model', next.modelId);
  text('status', statuses[next.status] || next.status); $('status-dot').className = next.status;
  text('active', next.active); text('capacity', next.capacity); text('slots', `${next.availableSlots} 个空闲并发`);
  text('speed', Math.round(next.chunkSize * 1000 / next.intervalMs));
  text('router', next.router); text('wallet', next.wallet);
  text('wallet-mode', next.walletMode === 'browser-wallet' ? '网页钱包 · 每次连接签署一次身份挑战' : next.walletMode === 'alchemy-session' ? 'Alchemy session · 委托消息签名' : next.ephemeralWallet ? '临时演示钱包 · 重启后更换' : '本地环境变量钱包');
  text('toggle', next.enabled ? '下线节点' : next.walletMode === 'browser-wallet' ? '连接网页钱包' : '上线节点');
  $('browser-wallet').hidden = next.walletMode !== 'browser-wallet';
  $('browser-connect').disabled = next.enabled || Boolean(browserLink);
  text('browser-wallet-ui', next.walletUi || '');
  text('browser-wallet-state', next.status === 'online' ? '身份认证已完成，节点在线接单。请保持控制台和钱包窗口打开。' : next.browserWallet?.error || ({ waiting: '等待你连接网页钱包并准备签名。', ready: '钱包已准备好，正在连接平台。', signing: '正在签署本次身份挑战。', signed: '本次身份签名已验证，等待平台确认。' })[next.browserWallet?.status] || '');
  text('pricing-reconnect', next.walletMode === 'browser-wallet' ? '本地配置保存后节点会下线，需要重新连接网页钱包；只有在平台网页发布的链上报价才会生效。当前订单必须先结束。' : '此版本控制台不提供链上发布功能。在线保存会重新连接以读取链上报价；当前订单必须先结束，订单使用开始时的报价快照。');
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
  const link = browserLink;
  if (link?.started && !link.starting) {
    if (link.lastStatus !== next.status) {
      link.lastStatus = next.status;
      sendWallet(link, { type: 'inferpool:provider-status', status: next.status, message: next.lastError || undefined });
    }
    if (next.status === 'offline') endBrowserLink(next.lastError || '节点已下线，请重新连接网页钱包。', false);
  }
}

async function postControl(path, payload = {}, keepalive = false) {
  const mutation = path !== '/api/browser/challenge';
  if (mutation) stateEpoch++;
  try {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Provider-Control': token }, body: JSON.stringify(payload), keepalive });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '操作失败');
    return result;
  } finally { if (mutation) stateEpoch++; }
}

async function control(path, payload = {}) {
  if (busy) return;
  busy = true; flash = '';
  try {
    const result = await postControl(path, payload);
    render(result);
  } catch (error) { flash = error.message; showError(flash); }
  finally { busy = false; if (state) $('save-pricing').disabled = state.active > 0; }
}

$('toggle').addEventListener('click', () => {
  if (state?.walletMode !== 'browser-wallet') return void control(state?.enabled ? '/api/offline' : '/api/online');
  if (state.enabled || browserLink) endBrowserLink('节点已下线；重新上线需要再次准备签名。');
  else openBrowserWallet();
});
$('browser-connect').addEventListener('click', openBrowserWallet);
$('mode').addEventListener('change', (event) => control('/api/mode', { mode: event.target.value }));
$('pricing').addEventListener('input', () => { pricingDirty = true; });
$('pricing').addEventListener('submit', async (event) => {
  event.preventDefault();
  const pricing = Object.fromEntries(new FormData(event.currentTarget));
  await control('/api/pricing', { pricing });
  if (!flash) pricingDirty = false;
});

async function poll() {
  const epoch = stateEpoch;
  try {
    const response = await fetch('/api/state');
    if (!response.ok) throw new Error('状态读取失败');
    const next = await response.json();
    if (!busy && epoch === stateEpoch) render(next);
  } catch { showError('本地节点已停止或无法连接，请在终端重新启动。'); }
  finally { setTimeout(poll, 1000); }
}
void poll();

function sendWallet(link, message) {
  if (browserLink === link && !link.popup.closed) link.popup.postMessage(message, link.origin);
}

function endBrowserLink(message, stopNode = true) {
  const link = browserLink;
  if (link) sendWallet(link, { type: 'inferpool:provider-status', status: 'offline', message });
  browserLink = null;
  if (state?.walletMode === 'browser-wallet' && stopNode) {
    browserReset = Promise.all([browserReset.catch(() => {}), link?.startPromise?.catch(() => {})]).then(() => postControl('/api/offline')).then(next => {
      if (!browserLink) render(next);
    }).catch(error => { if (!browserLink) showError(error.message); });
  }
  $('browser-connect').disabled = false;
  text('browser-wallet-state', message);
}

function openBrowserWallet() {
  if (!state || state.walletMode !== 'browser-wallet' || state.enabled || browserLink) return;
  const origin = state.walletUi;
  if (typeof origin !== 'string') return showError('钱包网页地址未配置。');
  const popup = window.open(`${origin}/provider-connect?node_origin=${encodeURIComponent(location.origin)}`, '_blank', 'popup,width=540,height=780');
  if (!popup) return showError('浏览器拦截了钱包窗口，请允许弹出窗口后重试。');
  browserLink = { popup, origin, providerId: state.providerId, wallet: state.wallet, routerOrigin: state.routerOrigin, readyUsed: false, started: false, starting: false, requestId: null, signatureSubmitted: false, polling: false, lastStatus: null };
  $('browser-connect').disabled = true;
  text('browser-wallet-state', '在打开的钱包页面完成登录，再点击准备好签名。');
}

window.addEventListener('message', event => {
  const link = browserLink;
  if (!link || event.origin !== link.origin || event.source !== link.popup || link.popup.closed || !event.data || typeof event.data !== 'object') return;
  const message = event.data;
  if (message.type === 'inferpool:popup-ready') {
    sendWallet(link, { type: 'inferpool:provider-info', nodeOrigin: location.origin, providerId: link.providerId, wallet: link.wallet, routerOrigin: link.routerOrigin });
  } else if (message.type === 'inferpool:wallet-ready') {
    if (link.readyUsed || typeof message.wallet !== 'string' || message.wallet.toLowerCase() !== link.wallet.toLowerCase()) return;
    link.readyUsed = true; link.starting = true;
    const start = browserReset.then(() => {
      if (browserLink !== link || link.popup.closed) return;
      return postControl('/api/browser/ready', { wallet: message.wallet }).then(next => {
        if (browserLink !== link) return;
        link.started = true; link.starting = false; render(next);
        void pollBrowserChallenge();
      });
    });
    link.startPromise = start;
    void start.catch(error => { if (browserLink === link) { showError(error.message); endBrowserLink(error.message); } });
  } else if (message.type === 'inferpool:provider-signature') {
    if (!link.started || !link.requestId || message.requestId !== link.requestId || link.signatureSubmitted || typeof message.signature !== 'string') return;
    link.signatureSubmitted = true;
    void postControl('/api/browser/signature', { requestId: message.requestId, signature: message.signature }).then(next => {
      if (browserLink === link) render(next);
    }).catch(error => { if (browserLink === link) { showError(error.message); endBrowserLink(error.message); } });
  } else if (message.type === 'inferpool:provider-signing-error') {
    if (message.requestId !== undefined && message.requestId !== link.requestId) return;
    const detail = typeof message.message === 'string' ? message.message.slice(0, 300) : '网页钱包未完成签名。';
    endBrowserLink(detail);
  }
});

async function pollBrowserChallenge() {
  const link = browserLink;
  if (!link) return;
  if (link.popup.closed) return endBrowserLink('网页钱包窗口已关闭，节点已下线。');
  if (!link.started || link.starting || link.polling || link.requestId) return;
  link.polling = true;
  try {
    const result = await postControl('/api/browser/challenge');
    if (browserLink !== link || link.popup.closed) return;
    const challenge = result.challenge;
    if (challenge && typeof challenge.requestId === 'string' && typeof challenge.message === 'string' && Number.isSafeInteger(challenge.expiresAt)) {
      link.requestId = challenge.requestId;
      sendWallet(link, { type: 'inferpool:provider-challenge', ...challenge });
    }
  } catch (error) { if (browserLink === link) { showError(error.message); endBrowserLink(error.message); } }
  finally { link.polling = false; }
}
setInterval(() => { void pollBrowserChallenge(); }, 200);
window.addEventListener('pagehide', () => {
  if (!browserLink) return;
  sendWallet(browserLink, { type: 'inferpool:provider-status', status: 'offline', message: '本地控制台已关闭，节点已下线。' });
  browserLink = null;
  void postControl('/api/offline', {}, true).catch(() => {});
});
