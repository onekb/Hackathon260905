export type TrustProxy = 'none' | 'loopback';

export function parseTrustProxy(value: string | undefined): TrustProxy {
  if (value === undefined || value === 'none') return 'none';
  if (value === 'loopback') return value;
  throw new Error('ROUTER_TRUST_PROXY must be exactly none or loopback');
}
