export const SCALE = 1_000_000n;
export interface Quote { input: string; cacheRead: string; cacheWrite: string; output: string; minReserve: string; version?: string }
export interface Usage { input: number; cacheRead: number; cacheWrite: number; output: number }
export const emptyUsage = (): Usage => ({input: 0, cacheRead: 0, cacheWrite: 0, output: 0});
export function units(value: string): bigint {
  if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value)) throw new Error('Amount must be a nonnegative decimal string with at most 6 places');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, '0'));
}
export function decimal(value: bigint): string {
  return `${value / SCALE}.${(value % SCALE).toString().padStart(6, '0')}`;
}
export function fee(quote: Quote, usage: Usage): bigint {
  let numerator = 0n;
  for (const key of ['input', 'cacheRead', 'cacheWrite', 'output'] as const) {
    if (!Number.isSafeInteger(usage[key]) || usage[key] < 0) throw new Error('Invalid mock token count');
    numerator += units(quote[key]) * BigInt(usage[key]);
  }
  return (numerator + SCALE - 1n) / SCALE;
}
export const mockTokens = (text: string): number => Array.from(text).length;
