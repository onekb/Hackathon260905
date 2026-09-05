import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseConfig, usage, type ProviderConfig } from './config.js';
import { ProviderClient } from './client.js';
import { BrowserWalletBridge, createProviderAccount, type ProviderAccount } from './signer.js';

export async function startProvider(config: ProviderConfig, account: ProviderAccount, browser?: BrowserWalletBridge) {
  if (Boolean(config.browserWallet) !== Boolean(browser) || (browser && account !== browser.account)) throw new Error('网页钱包必须使用本地一次性签名桥。');
  const client = new ProviderClient(config, account);
  const controlToken = randomBytes(32).toString('hex');
  const assetRoot = new URL('../public/', import.meta.url);
  const snapshot = () => ({ ...client.snapshot(), ...(browser ? { browserWallet: browser.snapshot() } : {}) });

  function json(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(body));
  }

  async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
    let data = '';
    for await (const chunk of request) {
      data += chunk.toString();
      if (Buffer.byteLength(data) > 8192) throw new Error('请求内容过大');
    }
    const value = JSON.parse(data || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('无效 JSON');
    return value;
  }

  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    void (async () => {
      const host = request.headers.host ?? '';
      const address = server.address();
      const port = address && typeof address !== 'string' ? address.port : config.port;
      const localHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
      if (!localHosts.has(host)) return json(response, 403, { error: '控制台仅允许本机访问' });
      if (request.headers.origin && request.headers.origin !== `http://${host}`) return json(response, 403, { error: '不允许跨来源控制请求' });
      const path = new URL(request.url ?? '/', `http://${host}`).pathname;
      if (request.method === 'GET' && path === '/api/state') return json(response, 200, snapshot());
      if (request.method === 'POST' && path.startsWith('/api/')) {
        const token = request.headers['x-provider-control'];
        if (typeof token !== 'string' || token.length !== controlToken.length || !timingSafeEqual(Buffer.from(token), Buffer.from(controlToken))) return json(response, 403, { error: '控制请求缺少有效本地凭证，请刷新页面' });
        if (!request.headers['content-type']?.startsWith('application/json')) return json(response, 415, { error: '请求必须使用 application/json' });
        const payload = await body(request);
        if (path.startsWith('/api/browser/')) {
          if (!browser) return json(response, 400, { error: '当前节点未配置网页钱包模式。' });
          if (path === '/api/browser/ready') {
            if (client.snapshot().enabled) throw new Error('节点已在连接或在线，请先下线再准备新的钱包握手。');
            browser.prepare(payload.wallet); client.online();
          } else if (path === '/api/browser/challenge') return json(response, 200, { challenge: browser.challenge(), browserWallet: browser.snapshot() });
          else if (path === '/api/browser/signature') await browser.submit(payload.requestId, payload.signature);
          else if (path === '/api/browser/error') { browser.fail(payload.requestId); client.offline(); }
          else return json(response, 404, { error: '接口不存在' });
          return json(response, 200, snapshot());
        }
        if (path === '/api/mode') client.setMode(payload.mode);
        else if (path === '/api/online') {
          if (browser) throw new Error('请点击连接网页钱包，并在网页中准备好签名后上线。');
          client.online();
        }
        else if (path === '/api/offline') client.offline();
        else if (path === '/api/pricing') client.setPricing(payload.pricing);
        else return json(response, 404, { error: '接口不存在' });
        return json(response, 200, snapshot());
      }
      const asset = path === '/' ? 'index.html' : path === '/app.js' ? 'app.js' : path === '/style.css' ? 'style.css' : null;
      if (request.method !== 'GET' || !asset) return json(response, 404, { error: '未找到页面' });
      let contents = await readFile(new URL(asset, assetRoot), 'utf8');
      if (asset === 'index.html') contents = contents.replace('__CONTROL_TOKEN__', controlToken);
      response.writeHead(200, { 'Content-Type': asset.endsWith('.html') ? 'text/html; charset=utf-8' : asset.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8' });
      response.end(contents);
    })().catch((error) => json(response, 400, { error: error instanceof Error ? error.message : '控制请求失败' }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, '127.0.0.1', resolve);
  });
  if (!browser) client.online();
  return {
    server, client,
    stop: async () => {
      client.offline();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

async function main(): Promise<void> {
  const config = parseConfig(process.argv.slice(2), process.env);
  const browser = config.browserWallet ? new BrowserWalletBridge(config) : undefined;
  const account = browser?.account ?? await createProviderAccount(config, process.env);
  const { stop: stopProvider } = await startProvider(config, account, browser);
  console.log(`InferPool Mock 卖家已启动：${config.name} (${config.id})`);
  console.log(`本地控制台：http://127.0.0.1:${config.port}`);
  console.log(`公开收款地址：${account.address}`);
  console.log(browser ? '身份：网页钱包（等待本地控制台连接；每次上线签署一次身份挑战，不导出私钥）' : config.alchemySession ? '身份：Alchemy session（仅委托消息签名，不读取钱包原始私钥）' : config.ephemeral ? '身份：本进程临时演示钱包（重启后更换，不可用于保存实际资产）' : '身份：环境变量中的钱包（私钥仅保留在本地进程）');
  console.log('推理、Token 和缓存均为模拟。Router 负责最终账单与链上结算。');
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void stopProvider().then(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) console.log(usage);
  else void main().catch((error) => {
    console.error(error instanceof Error ? error.message : '节点启动失败');
    process.exitCode = 1;
  });
}
