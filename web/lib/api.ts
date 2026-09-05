export const ROUTER_URL = (process.env.NEXT_PUBLIC_ROUTER_URL || 'http://127.0.0.1:8788').replace(/\/$/, '');
export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'ApiError'; }
}
export async function api<T>(path: string, token?: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(ROUTER_URL + path, { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers }, cache: 'no-store' });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new ApiError(body.error?.message || `请求失败 (${response.status})`, response.status); }
  return response.status === 204 ? undefined as T : response.json();
}
export const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
export function modelLabel(model: string) { return model === 'mock-reasoner' ? 'Reasoner' : model; }
export function short(value?: string) { return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '未连接'; }
export function txUrl(hash: string, chainId: number) { return chainId === 10143 ? `https://testnet.monadscan.com/tx/${hash}` : undefined; }
