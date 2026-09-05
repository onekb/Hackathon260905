import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { parseConfig, usage } from './config.js';
import { ProviderClient } from './client.js';
import { createProviderAccount } from './signer.js';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(usage);
  process.exit(0);
}

async function main(): Promise<void> {
  const config = parseConfig(process.argv.slice(2), process.env);
  const account = await createProviderAccount(config, process.env);
  const client = new ProviderClient(config, account);
  const controlToken = randomBytes(32).toString('hex');
  const localHosts = new Set([`127.0.0.1:${config.port}`, `localhost:${config.port}`]);
  const assetRoot = new URL('../public/', import.meta.url);

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
      if (!localHosts.has(host)) return json(response, 403, { error: '控制台仅允许本机访问' });
      if (request.headers.origin && request.headers.origin !== `http://${host}`) return json(response, 403, { error: '不允许跨来源控制请求' });
      const path = new URL(request.url ?? '/', `http://${host}`).pathname;
      if (request.method === 'GET' && path === '/api/state') return json(response, 200, client.snapshot());
      if (request.method === 'POST' && path.startsWith('/api/')) {
        const token = request.headers['x-provider-control'];
        if (typeof token !== 'string' || token.length !== controlToken.length || !timingSafeEqual(Buffer.from(token), Buffer.from(controlToken))) return json(response, 403, { error: '控制请求缺少有效本地凭证，请刷新页面' });
        if (!request.headers['content-type']?.startsWith('application/json')) return json(response, 415, { error: '请求必须使用 application/json' });
        const payload = await body(request);
        if (path === '/api/mode') client.setMode(payload.mode);
        else if (path === '/api/online') client.online();
        else if (path === '/api/offline') client.offline();
        else if (path === '/api/pricing') client.setPricing(payload.pricing);
        else return json(response, 404, { error: '接口不存在' });
        return json(response, 200, client.snapshot());
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
  client.online();
  console.log(`InferPool Mock 卖家已启动：${config.name} (${config.id})`);
  console.log(`本地控制台：http://127.0.0.1:${config.port}`);
  console.log(`公开收款地址：${account.address}`);
  console.log(config.alchemySession ? '身份：Alchemy session（仅委托消息签名，不读取钱包原始私钥）' : config.ephemeral ? '身份：本进程临时演示钱包（重启后更换，不可用于保存实际资产）' : '身份：环境变量中的钱包（私钥仅保留在本地进程）');
  console.log('推理、Token 和缓存均为模拟。Router 负责最终账单与链上结算。');
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    client.offline();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : '节点启动失败');
  process.exitCode = 1;
});
