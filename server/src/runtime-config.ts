export interface DemoAdmission {
  readonly startMs: number;
  readonly newOrdersEnabled: boolean;
}

export const DEMO_LIMITS = Object.freeze({ walletConcurrent: 1, walletPerUtcDay: 6, globalConcurrent: 2, globalAttempts: 10 });
export type TrustProxy = 'none' | 'loopback';

function boolean(value: string | undefined, name: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value !== 'true' && value !== 'false') throw new Error(`${name} must be exactly true or false`);
  return value === 'true';
}

export function parseDemoAdmission(env: NodeJS.ProcessEnv, now = Date.now()): DemoAdmission | undefined {
  const enabled = boolean(env.DEMO_ADMISSION_ENABLED, 'DEMO_ADMISSION_ENABLED', false);
  const newOrdersEnabled = boolean(env.DEMO_NEW_ORDERS_ENABLED, 'DEMO_NEW_ORDERS_ENABLED', true);
  const start = env.DEMO_ADMISSION_START_UTC;
  if (!enabled) {
    if (start !== undefined || env.DEMO_NEW_ORDERS_ENABLED !== undefined) throw new Error('DEMO_ADMISSION_START_UTC and DEMO_NEW_ORDERS_ENABLED require DEMO_ADMISSION_ENABLED=true');
    return undefined;
  }
  if (!start || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(start)) throw new Error('DEMO_ADMISSION_START_UTC must be an explicit fixed ISO UTC timestamp');
  const startMs = Date.parse(start);
  const normalized = start.includes('.') ? start : start.replace('Z', '.000Z');
  if (!Number.isFinite(startMs) || startMs <= 0 || new Date(startMs).toISOString() !== normalized || startMs > now) throw new Error('DEMO_ADMISSION_START_UTC must be a valid timestamp at or before startup; never generate it on each restart');
  return Object.freeze({ startMs, newOrdersEnabled });
}

export function parseTrustProxy(value: string | undefined): TrustProxy {
  if (value === undefined || value === 'none') return 'none';
  if (value === 'loopback') return value;
  throw new Error('ROUTER_TRUST_PROXY must be exactly none or loopback');
}
