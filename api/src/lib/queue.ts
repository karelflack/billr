import { Queue } from 'bullmq';
import { redis } from './redis';

// Custom backoff delays in milliseconds for each attempt index (0-based).
// Attempt 0 = immediate, 1 = +5s, 2 = +30s, 3 = +2m, 4 = +10m, 5 = +1h.
// After 6 attempts the job moves to the dead-letter set.
export const WEBHOOK_BACKOFF_DELAYS = [0, 5_000, 30_000, 120_000, 600_000, 3_600_000];

export function getBackoffDelay(attemptsMade: number): number {
  return WEBHOOK_BACKOFF_DELAYS[attemptsMade] ?? 3_600_000;
}

export interface WebhookJobData {
  deliveryId: string;
  endpointUrl: string;
  secretEncrypted: string;
  eventType: string;
  payload: Record<string, unknown>;
  accountId: string;
}

// The single BullMQ queue used for all outbound webhook delivery jobs.
// Workers are defined separately in src/worker.ts.
export const webhookQueue = new Queue<WebhookJobData>('webhook-delivery', {
  connection: redis,
  defaultJobOptions: {
    attempts: 6,
    backoff: {
      type: 'custom',
    },
    removeOnComplete: { count: 1000 },
    removeOnFail: false,
  },
});
