import type { Order } from './types';

export type OrderSnapshot = Order & { updatedAt?: number };
export const executionEnded = (order: Pick<Order, 'status'>) => ['completed', 'budget_capped', 'buyer_cancelled', 'seller_failed', 'platform_failed', 'lock_failed'].includes(order.status);

/** Reconcile the same order delivered independently by SSE and HTTP polling. */
export function newerSnapshot(previous: OrderSnapshot | undefined, incoming: OrderSnapshot): OrderSnapshot {
  if (!previous) return incoming;
  if (previous.billConfirmed && !incoming.billConfirmed) return previous;
  if (executionEnded(previous) && !executionEnded(incoming)) return previous;
  // Millisecond timestamps can tie when queued chunks arrive together. Output and
  // execution progress still only move forward, including when an older poll arrives last.
  if (incoming.output.length < previous.output.length || incoming.usage.output < previous.usage.output) return previous;
  if (previous.status === 'running' && incoming.status === 'locking') return previous;
  if (previous.updatedAt !== undefined && incoming.updatedAt !== undefined && previous.updatedAt > incoming.updatedAt) return previous;
  return incoming;
}
