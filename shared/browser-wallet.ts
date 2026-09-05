import { getAddress, isAddress, type Address } from 'viem';

export interface BrowserProviderInfo {
  type: 'inferpool:provider-info';
  nodeOrigin: string;
  providerId: string;
  wallet: Address;
  routerOrigin: string;
}
export interface BrowserProviderChallenge {
  type: 'inferpool:provider-challenge';
  requestId: string;
  message: string;
  expiresAt: number;
  nonce: string;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('节点连接消息格式无效。');
  return value as Record<string, unknown>;
}

export function parseLoopbackOrigin(value: unknown): string {
  if (typeof value !== 'string') throw new Error('缺少本地节点地址，请从卖家客户端打开此窗口。');
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || !url.port || Number(url.port) < 1024 || Number(url.port) > 65535 || value !== url.origin) {
    throw new Error('只允许连接本机回环地址上的卖家客户端。');
  }
  return url.origin;
}

export function parseBrowserProviderInfo(value: unknown, nodeOrigin: string, routerOrigin: string): BrowserProviderInfo {
  const data = record(value);
  if (data.type !== 'inferpool:provider-info' || data.nodeOrigin !== nodeOrigin || data.routerOrigin !== routerOrigin
    || typeof data.providerId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(data.providerId)
    || typeof data.wallet !== 'string' || !isAddress(data.wallet)) {
    throw new Error('节点身份或平台地址与当前页面不一致。');
  }
  return { type: 'inferpool:provider-info', nodeOrigin, providerId: data.providerId, wallet: getAddress(data.wallet), routerOrigin };
}

export function parseBrowserProviderChallenge(value: unknown, routerOrigin: string, now = Date.now()): BrowserProviderChallenge {
  const data = record(value);
  if (data.type !== 'inferpool:provider-challenge' || typeof data.requestId !== 'string'
    || !/^[a-zA-Z0-9_-]{16,128}$/.test(data.requestId) || typeof data.message !== 'string'
    || data.message.length > 1024 || typeof data.expiresAt !== 'number' || !Number.isSafeInteger(data.expiresAt)) {
    throw new Error('节点登录挑战格式无效。');
  }
  const lines = data.message.split('\n');
  const nonce = lines[2]?.slice('Nonce: '.length);
  if (lines.length !== 5 || lines[0] !== 'InferPool provider authentication'
    || lines[1] !== `Domain: ${new URL(routerOrigin).host}` || !lines[2]?.startsWith('Nonce: ')
    || !nonce || !/^[a-f0-9]{48}$/.test(nonce) || lines[3] !== `Expires: ${data.expiresAt}`
    || !/^Expires: \d{13}$/.test(lines[3]) || data.expiresAt <= now || data.expiresAt > now + 300_000
    || lines[4] !== 'This signature authenticates this session only. It does not authorize token transfers.') {
    throw new Error('拒绝签署非本平台、过期或额外包含其他内容的节点登录消息。');
  }
  return { type: 'inferpool:provider-challenge', requestId: data.requestId, message: data.message, expiresAt: data.expiresAt, nonce };
}
