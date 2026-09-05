import { access, readFile, readdir, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sign as signChallenge } from 'node:crypto';
import { getAddress, verifyMessage, type Hex, type PrivateKeyAccount } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { ProviderConfig } from './config.js';

/** Only authentication signing is exposed; no transaction or private-key API. */
export type ProviderAccount = Pick<PrivateKeyAccount, 'address' | 'signMessage'>;
export class ProviderSigningError extends Error {}

type Session = {
  sessionId: string;
  walletId?: string;
  evmWalletId?: string;
  evmAddress?: string;
  status: string;
  expiresAt: string;
  privateKeyPem: string;
  privyKeyQuorumId?: string;
  privySignerId?: string;
  capabilities?: Record<string, boolean>;
  sessionsByChain?: Record<string, {
    sessionId: string; walletId: string; walletAddress: string; status: string;
    expiresAt: string; providerKeyQuorumId?: string; providerSignerId?: string;
    capabilities?: Record<string, boolean>;
  }>;
};
export type SessionResolver = {
  resolveWalletSession: () => Session | null;
  resolveAuthToken: () => string | undefined;
};
type AdapterOptions = { loadResolver?: () => Promise<SessionResolver>; fetch?: typeof fetch; env?: NodeJS.ProcessEnv };

/** The CLI currently has no public sign-message command. Fail closed on bundle/API changes. */
async function loadAlchemyResolver(): Promise<SessionResolver> {
  let entry: string | undefined;
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue;
    try {
      const candidate = join(directory, process.platform === 'win32' ? 'alchemy.cmd' : 'alchemy');
      await access(candidate, constants.X_OK);
      entry = await realpath(candidate);
      break;
    } catch { /* Continue looking for the installed executable without logging paths. */ }
  }
  if (!entry) throw new ProviderSigningError('未找到 Alchemy CLI。请安装并连接 session 后再启动节点。');
  try {
    const dist = dirname(entry);
    const manifest = JSON.parse(await readFile(join(dist, '..', 'package.json'), 'utf8'));
    if (manifest.name !== '@alchemy/cli' || manifest.version !== '0.24.0') throw new Error('unsupported version');
    const bundles = (await readdir(dist)).filter((name) => /^resolve-[A-Za-z0-9]+\.js$/.test(name));
    if (bundles.length !== 1) throw new Error('unsupported bundle layout');
    const resolver = await import(pathToFileURL(join(dist, bundles[0]!)).href) as SessionResolver;
    if (typeof resolver.resolveWalletSession !== 'function' || typeof resolver.resolveAuthToken !== 'function') throw new Error('unsupported resolver exports');
    return resolver;
  } catch {
    throw new ProviderSigningError('当前 session 适配器需要 Alchemy CLI 0.24.0 的会话接口；版本或安装结构不兼容，不会回退到本地钱包。');
  }
}

export function alchemyWalletApiBase(env: NodeJS.ProcessEnv): string {
  const domain = env.ALCHEMY_BASE_DOMAIN ?? 'alchemy.com';
  if (!['alchemy.com', 'alchemypreview.com'].includes(domain)) throw new ProviderSigningError('不支持该 Alchemy API 域名；不会向非官方地址发送会话凭证。');
  let url: URL;
  try { url = new URL(env.ALCHEMY_WALLET_API_BASE_URL ?? env.ALCHEMY_ADMIN_API_BASE_URL ?? `https://admin-api.${domain}`); }
  catch { throw new ProviderSigningError('Alchemy API 地址格式无效。'); }
  if (url.protocol !== 'https:' || !['admin-api.alchemy.com', 'admin-api.alchemypreview.com'].includes(url.hostname) || url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new ProviderSigningError('Alchemy 会话签名仅允许官方 HTTPS 地址，不使用本地或自定义凭证接收端点。');
  return url.origin;
}

function readActiveSession(resolver: SessionResolver): { session: Session; authToken: string } {
  let original: Session | null;
  let authToken: string | undefined;
  try { original = resolver.resolveWalletSession(); authToken = resolver.resolveAuthToken(); }
  catch { throw new ProviderSigningError('无法读取 Alchemy session。请检查 Alchemy CLI 的会话状态。'); }
  if (!original || !authToken) throw new ProviderSigningError('Alchemy session 未激活或已过期，请通过 Alchemy CLI 连接 session 后重试。');
  // Same EVM chain-session selection as CLI getWalletSessionByChain(session, "evm").
  const evm = original.sessionsByChain?.evm;
  if (original.sessionsByChain && !evm) throw new ProviderSigningError('当前 Alchemy session 没有有效 EVM 钱包。');
  const session = evm ? {
    ...original, sessionId: evm.sessionId, walletId: evm.walletId, evmWalletId: evm.walletId,
    evmAddress: evm.walletAddress, status: evm.status, expiresAt: evm.expiresAt,
    privyKeyQuorumId: evm.providerKeyQuorumId, privySignerId: evm.providerSignerId,
    capabilities: evm.capabilities ?? original.capabilities,
  } : original;
  if (session.status !== 'approved' || !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= Date.now()) throw new ProviderSigningError('Alchemy EVM session 未激活或已过期，请重新连接 session。');
  if (session.capabilities?.['evm.signMessage'] === false) throw new ProviderSigningError('当前 Alchemy session 不允许消息签名，请连接具有 evm.signMessage 权限的 session。');
  if (!session.evmAddress || !/^0x[0-9a-fA-F]{40}$/.test(session.evmAddress) || !session.sessionId || !(session.walletId ?? session.evmWalletId) || !(session.privyKeyQuorumId || session.privySignerId) || !session.privateKeyPem) throw new ProviderSigningError('Alchemy session 缺少 EVM 委托签名信息，请重新连接 session；不会改用原始私钥。');
  return { session, authToken };
}

/** Mirrors CLI 0.24.0 delegated signMessage. The validation policy is private, never caller-supplied. */
async function createScopedAlchemySessionAccount(options: AdapterOptions, validateMessage: (message: unknown, address: string) => asserts message is string): Promise<ProviderAccount> {
  const env = options.env ?? process.env;
  const base = alchemyWalletApiBase(env);
  const resolver = await (options.loadResolver ?? loadAlchemyResolver)();
  const address = getAddress(readActiveSession(resolver).session.evmAddress!);
  const request = options.fetch ?? fetch;
  async function post(path: string, token: string, body: unknown): Promise<Record<string, unknown>> {
    try {
      const response = await request(base + path, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(7000),
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (response.status === 401 || response.status === 403) throw new ProviderSigningError('Alchemy 拒绝消息签名，会话可能已失效或缺少权限，请检查 session。');
      if (!response.ok) throw new ProviderSigningError(`Alchemy 消息签名服务暂不可用（HTTP ${response.status}）；未更换钱包，也未发起链上交易。`);
      const payload = await response.json() as { data?: unknown };
      if (!payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) throw new ProviderSigningError('Alchemy 消息签名返回格式不兼容。');
      return payload.data as Record<string, unknown>;
    } catch (error) {
      if (error instanceof ProviderSigningError) throw error;
      // Never surface backend bodies, session material, headers, or crypto internals.
      throw new ProviderSigningError('Alchemy 消息签名连接失败或超时，请检查网络和 session 状态。');
    }
  }
  return {
    address,
    async signMessage({ message }): Promise<Hex> {
      validateMessage(message, address);
      const { session, authToken } = readActiveSession(resolver);
      if (getAddress(session.evmAddress!) !== address) throw new ProviderSigningError('Alchemy session 钱包已改变，请重启卖家节点以确认新身份。');
      const challenge = await post('/wallet/evm/sign-message/challenge', authToken, {
        sessionId: session.sessionId, walletId: session.walletId ?? session.evmWalletId, walletAddress: address,
        ...(session.privyKeyQuorumId ? { providerKeyQuorumId: session.privyKeyQuorumId } : {}),
        ...(session.privySignerId ? { providerSignerId: session.privySignerId } : {}),
        message, encoding: 'utf-8',
      });
      if (challenge.method !== 'personal_sign' || typeof challenge.challengeId !== 'string' || typeof challenge.challenge !== 'string' || typeof challenge.walletAddress !== 'string' || challenge.walletAddress.toLowerCase() !== address.toLowerCase() || challenge.walletId !== (session.walletId ?? session.evmWalletId) || !Number.isFinite(Date.parse(String(challenge.expiresAt))) || Date.parse(String(challenge.expiresAt)) <= Date.now()) throw new ProviderSigningError('Alchemy 返回的消息签名挑战与当前会话不匹配。');
      let proof: string;
      try { proof = signChallenge('sha256', Buffer.from(challenge.challenge, 'utf8'), { key: session.privateKeyPem, dsaEncoding: 'der' }).toString('base64url'); }
      catch { throw new ProviderSigningError('Alchemy session 委托证明签名失败，请检查或重新连接 session。'); }
      const signed = await post('/wallet/evm/sign-message/complete', authToken, { challengeId: challenge.challengeId, signature: proof });
      if (typeof signed.signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signed.signature)) throw new ProviderSigningError('Alchemy 返回了不支持的身份签名格式。');
      let valid = false;
      try { valid = await verifyMessage({ address, message, signature: signed.signature as Hex }); } catch { /* Fail closed. */ }
      if (!valid) throw new ProviderSigningError('Alchemy 消息签名与当前卖家地址不匹配，拒绝发送到平台。');
      return signed.signature as Hex;
    },
  };
}

/** This provider entry point remains restricted to provider authentication. */
export async function createAlchemySessionAccount(options: AdapterOptions = {}): Promise<ProviderAccount> {
  return createScopedAlchemySessionAccount(options, (message): asserts message is string => {
    if (typeof message !== 'string' || !message.startsWith('InferPool provider authentication\n') || message.length > 4096 || !message.includes('\nNonce: ') || !message.includes('\nDomain: ')) throw new ProviderSigningError('Alchemy 卖家适配器仅签署 InferPool provider 身份挑战。');
  });
}

/** Explicit buyer-only factory for the testnet API smoke script, never an arbitrary message signer. */
export async function createAlchemyBuyerSessionAccount(options: AdapterOptions & { routerUrl: string }): Promise<ProviderAccount> {
  let router: URL;
  try { router = new URL(options.routerUrl); } catch { throw new ProviderSigningError('Router 地址格式无效。'); }
  if ((router.protocol !== 'https:' && !(router.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(router.hostname))) || router.username || router.password || router.search || router.hash || router.pathname !== '/') throw new ProviderSigningError('买家认证仅允许明确的 HTTPS Router 或本机 HTTP origin。');
  const usedNonces = new Set<string>();
  return createScopedAlchemySessionAccount(options, (message, address): asserts message is string => {
    if (typeof message !== 'string' || message.length > 1024) throw new ProviderSigningError('Alchemy 买家适配器仅签署精确的 InferPool buyer 身份挑战。');
    const lines = message.split('\n');
    const nonce = lines[3]?.match(/^Nonce: ([a-f0-9]{48})$/)?.[1];
    const expiresText = lines[4]?.match(/^Expires: ([0-9]{13})$/)?.[1];
    const expiresAt = Number(expiresText);
    if (lines.length !== 6 || lines[0] !== 'InferPool buyer authentication' || lines[1] !== `Domain: ${router.host}` || lines[2] !== `Wallet: ${address.toLowerCase()}` || !nonce || !expiresText || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 300_000 || lines[5] !== 'This signature authenticates this session only. It does not authorize token transfers.') throw new ProviderSigningError('买家身份挑战的用途、域名、钱包、格式或有效期不匹配。');
    if (usedNonces.has(nonce)) throw new ProviderSigningError('买家身份挑战已使用，不允许重放。');
    usedNonces.add(nonce);
  });
}

export async function createProviderAccount(config: ProviderConfig, env: NodeJS.ProcessEnv): Promise<ProviderAccount> {
  const privateKey = env.PROVIDER_PRIVATE_KEY;
  if (Number(Boolean(privateKey)) + Number(config.ephemeral) + Number(config.alchemySession) !== 1) throw new ProviderSigningError('请选择一种钱包身份：--alchemy-session、--ephemeral-wallet 或 PROVIDER_PRIVATE_KEY；不能同时设置。');
  if (config.alchemySession) return createAlchemySessionAccount({ env });
  if (privateKey && !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new ProviderSigningError('PROVIDER_PRIVATE_KEY 格式无效，应为 0x 开头的 32 字节私钥。');
  try { return privateKeyToAccount((privateKey ?? generatePrivateKey()) as Hex); }
  catch { throw new ProviderSigningError('钱包私钥值无效，请检查本地环境变量。'); }
}
