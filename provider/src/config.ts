import { MODES, type MockMode } from './mock-engine.js';
import { getAddress, type Address } from 'viem';

export type Pricing = { input: string; cacheRead: string; cacheWrite: string; output: string; minReserve: string };
export type ProviderConfig = {
  router: string;
  id: string;
  name: string;
  modelId: string;
  port: number;
  capacity: number;
  intervalMs: number;
  chunkSize: number;
  mode: MockMode;
  pricing: Pricing;
  ephemeral: boolean;
  alchemySession: boolean;
  browserWallet?: Address;
  walletUi?: string;
};

export function walletUiOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('--wallet-ui 必须是完整的钱包网页 origin'); }
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash || url.pathname !== '/' || !/^https?:\/\/[^\s\\/?#]+\/?$/.test(value)) throw new Error('--wallet-ui 仅允许 HTTPS 或本机 HTTP origin，不得包含凭证、路径、查询或片段');
  return url.origin;
}

export const usage = `InferPool 独立 Mock 卖家节点\n\n用法：npm run dev:provider -- --alchemy-session [选项]\n\n身份四选一：\n  --alchemy-session        使用当前 Alchemy CLI 会话，不需要钱包原始私钥\n  --ephemeral-wallet       生成仅本进程使用的临时演示钱包\n  --browser-wallet 0x…     通过指定网页钱包签署一次卖家身份挑战\n  --wallet-ui http://127.0.0.1:3000  网页钱包的固定 origin（与 browser-wallet 配套）\n  PROVIDER_PRIVATE_KEY     从本地环境变量读取钱包私钥\n四种身份模式互斥，不自动回退。不要在命令行参数中传私钥。\n\n选项：\n  --router ws://127.0.0.1:8787/provider\n  --id seller-a --name "卖家 A" --model mock-reasoner\n  --port 8791 --capacity 2 --interval-ms 80 --chunk-size 4\n  --mode normal|timeout|fail-before|fail-mid|cache-hit\n  --input-price 30 --cache-read-price 3 --cache-write-price 37.5\n  --output-price 80 --min-reserve 0.01\n\n单价均为每百万模拟 Token 的 DemoUSD。最低金额是预留要求，不是最低消费。\n远程平台必须使用 wss://；本地控制台仅监听 127.0.0.1。`;

export function validatePricing(value: unknown): Pricing {
  if (!value || typeof value !== 'object') throw new Error('报价必须是对象');
  const result = {} as Pricing;
  for (const key of ['input', 'cacheRead', 'cacheWrite', 'output', 'minReserve'] as const) {
    const price = (value as Record<string, unknown>)[key];
    if (typeof price !== 'string' || !/^\d{1,9}(\.\d{1,6})?$/.test(price)) {
      throw new Error('报价必须是非负十进制字符串，最多 6 位小数');
    }
    result[key] = price;
  }
  return result;
}

export function parseConfig(args: string[], env: NodeJS.ProcessEnv): ProviderConfig {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--') continue;
    if (flag === '--ephemeral-wallet' || flag === '--alchemy-session') { flags.set(flag, 'true'); continue; }
    if (!flag?.startsWith('--') || !args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error('参数格式错误；运行 --help 查看用法');
    flags.set(flag, args[++i]!);
  }
  const known = new Set(['--ephemeral-wallet', '--alchemy-session', '--router', '--id', '--name', '--model', '--port', '--capacity', '--interval-ms', '--chunk-size', '--mode', '--input-price', '--cache-read-price', '--cache-write-price', '--output-price', '--min-reserve', '--browser-wallet', '--wallet-ui']);
  for (const flag of flags.keys()) if (!known.has(flag)) throw new Error(`未知选项 ${flag}`);
  const read = (flag: string, envName: string, fallback: string) => flags.get(flag) ?? env[envName] ?? fallback;
  const integer = (flag: string, envName: string, fallback: string, min: number, max: number) => {
    const raw = read(flag, envName, fallback);
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${flag} 必须在 ${min}–${max} 之间`);
    return value;
  };
  const router = new URL(read('--router', 'PROVIDER_ROUTER_URL', 'ws://127.0.0.1:8787/provider'));
  if (router.protocol !== 'wss:' && !(router.protocol === 'ws:' && ['localhost', '127.0.0.1', '[::1]'].includes(router.hostname))) throw new Error('远程 Router 必须使用 wss://；ws:// 只允许回环地址');
  if (router.username || router.password || router.hash) throw new Error('Router URL 不能包含凭证或 URL fragment');
  const mode = read('--mode', 'PROVIDER_MODE', 'normal');
  if (!MODES.includes(mode as MockMode)) throw new Error('不支持的 Mock 模式');
  const id = read('--id', 'PROVIDER_ID', 'seller-a');
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error('卖家 ID 只允许 1–64 位字母、数字、下划线和连字符');
  const name = read('--name', 'PROVIDER_NAME', '独立卖家 A');
  const modelId = read('--model', 'PROVIDER_MODEL', 'mock-reasoner');
  if (name.length > 80 || !/^[a-zA-Z0-9_./-]{1,80}$/.test(modelId)) throw new Error('卖家名称或模型 ID 格式无效');
  const ephemeral = flags.get('--ephemeral-wallet') === 'true' || env.PROVIDER_EPHEMERAL === 'true';
  const alchemySession = flags.get('--alchemy-session') === 'true' || env.PROVIDER_ALCHEMY_SESSION === 'true';
  const browserAddress = read('--browser-wallet', 'PROVIDER_BROWSER_WALLET', '');
  const walletUiValue = read('--wallet-ui', 'PROVIDER_WALLET_UI', '');
  if (browserAddress && !/^0x[0-9a-fA-F]{40}$/.test(browserAddress)) throw new Error('--browser-wallet 必须是完整的 EVM 钱包地址');
  if (Boolean(browserAddress) !== Boolean(walletUiValue)) throw new Error('--browser-wallet 与 --wallet-ui 必须同时设置');
  const browserWallet = browserAddress ? getAddress(browserAddress) : undefined;
  const walletUi = walletUiValue ? walletUiOrigin(walletUiValue) : undefined;
  if (Number(ephemeral) + Number(alchemySession) + Number(Boolean(browserWallet)) + Number(Boolean(env.PROVIDER_PRIVATE_KEY)) > 1) throw new Error('钱包模式互斥：网页钱包、Alchemy session、临时钱包和 PROVIDER_PRIVATE_KEY 只能选择一种');
  return {
    router: router.toString(), id, name, modelId,
    port: integer('--port', 'PROVIDER_PORT', '8791', 1024, 65535),
    capacity: integer('--capacity', 'PROVIDER_CAPACITY', '2', 1, 32),
    intervalMs: integer('--interval-ms', 'PROVIDER_INTERVAL_MS', '80', 1, 10000),
    chunkSize: integer('--chunk-size', 'PROVIDER_CHUNK_SIZE', '4', 1, 32),
    mode: mode as MockMode,
    ephemeral, alchemySession, browserWallet, walletUi,
    pricing: validatePricing({
      input: read('--input-price', 'PROVIDER_INPUT_PRICE', '30'),
      cacheRead: read('--cache-read-price', 'PROVIDER_CACHE_READ_PRICE', '3'),
      cacheWrite: read('--cache-write-price', 'PROVIDER_CACHE_WRITE_PRICE', '37.5'),
      output: read('--output-price', 'PROVIDER_OUTPUT_PRICE', '80'),
      minReserve: read('--min-reserve', 'PROVIDER_MIN_RESERVE', '0.01'),
    }),
  };
}
