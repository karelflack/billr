/**
 * Billr Webhook Delivery Worker
 *
 * Runs as a separate Railway service. Picks up jobs from the `webhook-delivery`
 * BullMQ queue and POSTs the event payload to the customer's registered URL.
 *
 * Start via: npm run worker (runs dist/worker.js)
 */

import { Worker, Job } from 'bullmq';
import { redis } from './lib/redis';
import { decrypt, signPayload } from './lib/crypto';
import { prisma } from './lib/db';
import { WebhookJobData, getBackoffDelay } from './lib/queue';

const DELIVERY_TIMEOUT_MS = 10_000; // 10 second timeout per attempt

const worker = new Worker<WebhookJobData>(
  'webhook-delivery',
  async (job: Job<WebhookJobData>) => {
    const { deliveryId, endpointUrl, secretEncrypted, eventType, payload, accountId } = job.data;

    // Decrypt the per-endpoint secret for signing this delivery
    let secret: string;
    try {
      secret = decrypt(secretEncrypted);
    } catch (err) {
      console.error(`[worker] Failed to decrypt secret for delivery ${deliveryId}:`, err);
      throw new Error('Secret decryption failed');
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const payloadJson = JSON.stringify(payload);
    const signature = signPayload(secret, timestamp, payloadJson);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Billr-Event': eventType,
      'X-Billr-Delivery': deliveryId,
      'X-Billr-Signature': `t=${timestamp},v1=${signature}`,
      'User-Agent': 'Billr-Webhook/1.0',
    };

    let responseStatus: number | null = null;
    let responseBody: string | null = null;
    let errorMessage: string | null = null;
    let succeeded = false;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers,
        body: payloadJson,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      responseStatus = response.status;

      // Read up to 4KB of response body for debugging — don't buffer entire payload
      const bodyText = await response.text();
      responseBody = bodyText.slice(0, 4096);

      // HTTP 2xx = success
      succeeded = response.status >= 200 && response.status < 300;

      if (!succeeded) {
        throw new Error(`HTTP ${response.status}: ${responseBody.slice(0, 200)}`);
      }
    } catch (err) {
      if (err instanceof Error) {
        errorMessage = err.message.slice(0, 1000);
        if (err.name === 'AbortError') {
          errorMessage = `Delivery timeout after ${DELIVERY_TIMEOUT_MS}ms`;
        }
      }
      if (!succeeded) {
        // Update DB record with failure details before re-throwing for BullMQ retry
        await updateDeliveryRecord(deliveryId, {
          status: 'failed',
          responseStatus,
          responseBody,
          errorMessage,
          attemptCount: (job.attemptsMade ?? 0) + 1,
          lastAttemptAt: new Date(),
          nextAttemptAt: computeNextAttempt(job.attemptsMade),
        });
        throw err; // BullMQ will apply backoff and retry
      }
    }

    // Success path
    await updateDeliveryRecord(deliveryId, {
      status: 'delivered',
      responseStatus,
      responseBody,
      errorMessage: null,
      attemptCount: (job.attemptsMade ?? 0) + 1,
      lastAttemptAt: new Date(),
      nextAttemptAt: null,
    });
  },
  {
    connection: redis,
    concurrency: 10,
    // Custom backoff delay function — uses the same array as queue.ts
    settings: {
      backoffStrategy(attemptsMade: number): number {
        return getBackoffDelay(attemptsMade);
      },
    },
  },
);

// When a job exhausts all retries, mark the delivery as dead
worker.on('failed', async (job, err) => {
  if (!job) return;
  const isExhausted = job.attemptsMade >= (job.opts.attempts ?? 6);
  if (isExhausted) {
    console.error(`[worker] Delivery ${job.data.deliveryId} is dead after ${job.attemptsMade} attempts:`, err.message);
    await updateDeliveryRecord(job.data.deliveryId, {
      status: 'dead',
      errorMessage: `Exhausted all attempts. Last error: ${err.message.slice(0, 500)}`,
    });
  }
});

worker.on('completed', (job) => {
  console.log(`[worker] Delivery ${job.data.deliveryId} succeeded`);
});

worker.on('error', (err) => {
  console.error('[worker] Worker error:', err);
});

console.log('[worker] Webhook delivery worker started');

/** Partial update helper — only sets provided fields */
async function updateDeliveryRecord(
  deliveryId: string,
  data: {
    status?: 'pending' | 'delivered' | 'failed' | 'dead';
    responseStatus?: number | null;
    responseBody?: string | null;
    errorMessage?: string | null;
    attemptCount?: number;
    lastAttemptAt?: Date;
    nextAttemptAt?: Date | null;
  },
): Promise<void> {
  try {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        ...(data.status !== undefined && { status: data.status }),
        ...(data.responseStatus !== undefined && { response_status: data.responseStatus }),
        ...(data.responseBody !== undefined && { response_body: data.responseBody }),
        ...(data.errorMessage !== undefined && { error_message: data.errorMessage }),
        ...(data.attemptCount !== undefined && { attempt_count: data.attemptCount }),
        ...(data.lastAttemptAt !== undefined && { last_attempt_at: data.lastAttemptAt }),
        ...(data.nextAttemptAt !== undefined && { next_attempt_at: data.nextAttemptAt }),
      },
    });
  } catch (err) {
    console.error(`[worker] Failed to update delivery record ${deliveryId}:`, err);
  }
}

/** Computes the next retry time based on BullMQ attempt count */
function computeNextAttempt(attemptsMade: number): Date | null {
  const delayMs = getBackoffDelay(attemptsMade + 1);
  if (delayMs === 0) return null;
  return new Date(Date.now() + delayMs);
}
