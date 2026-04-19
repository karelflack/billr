/**
 * Billr — Webhook Delivery Worker
 *
 * Processes jobs from the `webhook-delivery` BullMQ queue.
 * Each job carries a delivery ID. The worker:
 *   1. Loads the delivery + endpoint from the DB
 *   2. Decrypts the signing secret (AES-256-GCM stored encrypted at rest)
 *   3. POSTs the payload with HMAC-SHA256 signature headers
 *   4. Updates delivery status and schedules retries on failure
 *
 * Retry schedule (attempt → delay before next try):
 *   0 → immediate, 1 → 5 s, 2 → 30 s, 3 → 2 min, 4 → 10 min, 5 → 60 min → dead
 *
 * Also runs a trial-ending check once per minute (pg_cron equivalent in Node).
 */

import { Worker, Job, Queue, QueueEvents } from "bullmq";
import { PrismaClient } from "@prisma/client";
import IORedis from "ioredis";
import axios, { AxiosError } from "axios";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// Config & constants
// ---------------------------------------------------------------------------

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const WEBHOOK_SECRET_ENCRYPTION_KEY = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY ?? "";
const QUEUE_NAME = "webhook-delivery";
const TRIAL_ENDING_CHECK_INTERVAL_MS = 60_000; // 1 minute

/**
 * Milliseconds to wait before each retry attempt.
 * Index = attemptsMade (number of times the job has already been tried).
 * Index 0 means "first attempt" — no delay needed.
 */
const RETRY_DELAYS = [0, 5_000, 30_000, 120_000, 600_000, 3_600_000];
const MAX_ATTEMPTS = RETRY_DELAYS.length; // 6

/**
 * Returns the delay (ms) before the next attempt based on how many
 * attempts have already been made. Falls back to 1 hour for anything
 * beyond the defined schedule (should not happen in practice).
 */
function getBackoffDelay(attemptsMade: number): number {
  return RETRY_DELAYS[attemptsMade] ?? 3_600_000;
}

// ---------------------------------------------------------------------------
// Shared infrastructure
// ---------------------------------------------------------------------------

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});

// BullMQ requires a dedicated ioredis connection that is not shared with
// other subscribers (BullMQ manages its own blocking commands internally).
const redisConnection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null, // required by BullMQ
  enableReadyCheck: false,
});

// Queue reference used for enqueuing trial-ending events and replays
const deliveryQueue = new Queue(QUEUE_NAME, { connection: redisConnection });

// ---------------------------------------------------------------------------
// Crypto helpers — AES-256-GCM encrypt/decrypt
// ---------------------------------------------------------------------------

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const KEY_BUFFER = Buffer.from(WEBHOOK_SECRET_ENCRYPTION_KEY, "hex"); // 32-byte hex key

interface EncryptedBlob {
  iv: string;    // hex
  tag: string;   // hex — GCM auth tag
  data: string;  // hex — ciphertext
}

/**
 * Decrypts an AES-256-GCM–encrypted webhook signing secret.
 * The encrypted_secret column stores JSON: { iv, tag, data } all hex-encoded.
 */
function decryptSecret(encryptedJson: string): string {
  const { iv, tag, data } = JSON.parse(encryptedJson) as EncryptedBlob;

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    KEY_BUFFER,
    Buffer.from(iv, "hex")
  );
  decipher.setAuthTag(Buffer.from(tag, "hex"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(data, "hex")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

/**
 * Produces the X-Billr-Signature header value.
 * Format: `t={timestamp},v1={hex_hmac}`
 *
 * The signed string is `${timestamp}.${JSON.stringify(payload)}`.
 * This prevents replay attacks when callers validate timestamp drift.
 */
function buildSignature(
  secret: string,
  timestamp: number,
  payload: unknown
): string {
  const signedString = `${timestamp}.${JSON.stringify(payload)}`;
  const hmac = crypto
    .createHmac("sha256", secret)
    .update(signedString)
    .digest("hex");
  return `t=${timestamp},v1=${hmac}`;
}

// ---------------------------------------------------------------------------
// Job payload type
// ---------------------------------------------------------------------------

interface WebhookDeliveryJobData {
  deliveryId: string;
}

// ---------------------------------------------------------------------------
// Core processor
// ---------------------------------------------------------------------------

async function processDelivery(job: Job<WebhookDeliveryJobData>): Promise<void> {
  const { deliveryId } = job.data;

  // ------------------------------------------------------------------
  // 1. Load delivery + endpoint from DB
  // ------------------------------------------------------------------
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: {
      endpoint: {
        select: {
          id: true,
          url: true,
          encrypted_secret: true,
          is_active: true,
        },
      },
    },
  });

  if (!delivery) {
    // Delivery record was deleted — nothing to do
    console.warn(`[worker] Delivery ${deliveryId} not found; skipping`);
    return;
  }

  if (!delivery.endpoint || !delivery.endpoint.is_active) {
    // Endpoint was disabled or removed after job was enqueued — skip silently
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: "dead",
        error_message: "Endpoint deactivated or deleted before delivery",
        last_attempt_at: new Date(),
      },
    });
    return;
  }

  // ------------------------------------------------------------------
  // 2. Decrypt signing secret
  // ------------------------------------------------------------------
  let secret: string;
  try {
    secret = decryptSecret(delivery.endpoint.encrypted_secret);
  } catch (err) {
    console.error(`[worker] Failed to decrypt secret for endpoint ${delivery.endpoint.id}:`, err);
    throw err; // Let BullMQ retry
  }

  // ------------------------------------------------------------------
  // 3. Build request
  // ------------------------------------------------------------------
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = delivery.payload as Record<string, unknown>;
  const signature = buildSignature(secret, timestamp, payload);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Billr-Webhook/1.0",
    "X-Billr-Event": delivery.event,
    "X-Billr-Delivery": delivery.id,
    "X-Billr-Signature": signature,
  };

  // ------------------------------------------------------------------
  // 4. POST to endpoint
  // ------------------------------------------------------------------
  let responseStatus: number | null = null;
  let errorMessage: string | null = null;
  let delivered = false;

  try {
    const response = await axios.post(delivery.endpoint.url, payload, {
      headers,
      timeout: 10_000, // 10 seconds
      // Do not throw on non-2xx so we can inspect the status ourselves
      validateStatus: () => true,
    });

    responseStatus = response.status;
    delivered = responseStatus >= 200 && responseStatus < 300;

    if (!delivered) {
      errorMessage = `Endpoint returned HTTP ${responseStatus}`;
    }
  } catch (err) {
    // Network error, DNS failure, or timeout
    const axiosErr = err as AxiosError;
    errorMessage = axiosErr.code === "ECONNABORTED"
      ? "Request timed out after 10 seconds"
      : axiosErr.message;
    console.error(`[worker] Network error delivering ${deliveryId}:`, errorMessage);
  }

  const attemptCount = (delivery.attempt_count ?? 0) + 1;

  // ------------------------------------------------------------------
  // 5. Update delivery record
  // ------------------------------------------------------------------
  if (delivered) {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: "delivered",
        response_status: responseStatus,
        attempt_count: attemptCount,
        last_attempt_at: new Date(),
        next_attempt_at: null,
      },
    });
    return;
  }

  // Determine whether this delivery is now exhausted
  const isDead = attemptCount >= MAX_ATTEMPTS;
  const nextDelay = isDead ? null : getBackoffDelay(attemptCount);
  const nextAttemptAt = nextDelay != null
    ? new Date(Date.now() + nextDelay)
    : null;

  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: {
      status: isDead ? "dead" : "failed",
      response_status: responseStatus,
      error_message: errorMessage,
      attempt_count: attemptCount,
      last_attempt_at: new Date(),
      next_attempt_at: nextAttemptAt,
    },
  });

  // ------------------------------------------------------------------
  // 6. Write to audit log on final failure (dead)
  // ------------------------------------------------------------------
  if (isDead) {
    console.error(
      `[worker] Delivery ${deliveryId} exhausted all ${MAX_ATTEMPTS} attempts — marking dead`
    );

    await prisma.auditLog.create({
      data: {
        action: "webhook.delivery.dead",
        actor_type: "system",
        resource_type: "webhook_delivery",
        resource_id: deliveryId,
        metadata: {
          endpoint_id: delivery.endpoint_id,
          event: delivery.event,
          attempt_count: attemptCount,
          last_error: errorMessage ?? "unknown",
        },
      },
    });
    // Do NOT throw — the job is intentionally finished (dead, not errored)
    return;
  }

  // Still retryable — throw so BullMQ re-queues with the custom backoff
  throw new Error(errorMessage ?? "Delivery failed");
}

// ---------------------------------------------------------------------------
// Worker instantiation
// ---------------------------------------------------------------------------

const worker = new Worker<WebhookDeliveryJobData>(
  QUEUE_NAME,
  processDelivery,
  {
    connection: redisConnection,
    concurrency: parseInt(process.env.WORKER_CONCURRENCY ?? "10", 10),
    settings: {
      // Custom backoff: use our RETRY_DELAYS schedule instead of BullMQ's
      // built-in exponential backoff.
      backoffStrategy: (attemptsMade: number): number => {
        return getBackoffDelay(attemptsMade);
      },
    },
    defaultJobOptions: {
      attempts: MAX_ATTEMPTS,
      backoff: {
        type: "custom",
      },
      removeOnComplete: { count: 1000, age: 60 * 60 * 24 * 7 }, // keep 7 days
      removeOnFail: { count: 5000, age: 60 * 60 * 24 * 30 }, // keep 30 days
    },
  }
);

worker.on("completed", (job) => {
  console.log(`[worker] Job ${job.id} (delivery ${job.data.deliveryId}) completed`);
});

worker.on("failed", (job, err) => {
  if (job) {
    const attemptsRemaining = MAX_ATTEMPTS - (job.attemptsMade ?? 0);
    console.warn(
      `[worker] Job ${job.id} (delivery ${job.data.deliveryId}) failed — ` +
      `${attemptsRemaining} attempt(s) remaining. Error: ${err.message}`
    );
  }
});

worker.on("error", (err) => {
  console.error("[worker] Worker error:", err);
});

// ---------------------------------------------------------------------------
// Trial-ending check — runs every minute (replaces pg_cron in local dev)
// ---------------------------------------------------------------------------
//
// In production you would use an actual pg_cron job:
//   SELECT cron.schedule('trial-ending-check', '* * * * *', $$
//     SELECT pg_notify('trial_ending_check', '{}');
//   $$);
//
// Here we poll from Node so the dev environment has no external scheduler
// dependency. The logic is identical to what a pg_cron job would do.

async function dispatchTrialEndingEvents(): Promise<void> {
  // Find subscriptions within 3 days of trial end that have not yet had
  // a trial_ending event dispatched.
  const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

  const subscriptions = await prisma.subscription.findMany({
    where: {
      status: "trialing",
      trial_end: {
        // Between now and 3 days from now
        gte: new Date(),
        lte: threeDaysFromNow,
      },
      trial_ending_notified: false,
    },
    include: {
      account: {
        select: { id: true, email: true },
      },
      plan: {
        select: { id: true, name: true },
      },
    },
  });

  for (const sub of subscriptions) {
    try {
      // Find all active webhook endpoints subscribed to this event
      const endpoints = await prisma.webhookEndpoint.findMany({
        where: {
          is_active: true,
          events: {
            // Endpoints with wildcard OR the specific event
            hasSome: ["*", "subscription.trial_ending"],
          },
        },
      });

      const payload = {
        event: "subscription.trial_ending",
        created_at: new Date().toISOString(),
        data: {
          subscription_id: sub.id,
          account_id: sub.account_id,
          plan_id: sub.plan_id,
          plan_name: sub.plan?.name ?? null,
          trial_end: sub.trial_end?.toISOString() ?? null,
          days_remaining: Math.ceil(
            ((sub.trial_end?.getTime() ?? 0) - Date.now()) / (1000 * 60 * 60 * 24)
          ),
        },
      };

      // Create a delivery record for each subscribed endpoint and enqueue
      for (const endpoint of endpoints) {
        const delivery = await prisma.webhookDelivery.create({
          data: {
            endpoint_id: endpoint.id,
            event: "subscription.trial_ending",
            payload: payload,
            status: "pending",
            attempt_count: 0,
          },
        });

        await deliveryQueue.add(
          "deliver",
          { deliveryId: delivery.id },
          {
            attempts: MAX_ATTEMPTS,
            backoff: { type: "custom" },
          }
        );
      }

      // Mark as notified so we don't dispatch again on the next tick
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { trial_ending_notified: true },
      });

      // Write audit entry
      await prisma.auditLog.create({
        data: {
          action: "subscription.trial_ending",
          actor_type: "system",
          resource_type: "subscription",
          resource_id: sub.id,
          metadata: {
            account_id: sub.account_id,
            trial_end: sub.trial_end?.toISOString(),
            endpoints_notified: endpoints.length,
          },
        },
      });

      console.log(
        `[trial-check] Dispatched subscription.trial_ending for sub ${sub.id} ` +
        `(${endpoints.length} endpoint(s))`
      );
    } catch (err) {
      // Log but continue processing other subscriptions — partial failure
      // should not block the rest of the batch.
      console.error(`[trial-check] Error processing sub ${sub.id}:`, err);
    }
  }
}

let trialCheckTimer: NodeJS.Timeout | null = null;

function startTrialEndingCheck(): void {
  // Run immediately on startup, then repeat on the interval
  void dispatchTrialEndingEvents();
  trialCheckTimer = setInterval(() => {
    void dispatchTrialEndingEvents();
  }, TRIAL_ENDING_CHECK_INTERVAL_MS);
}

startTrialEndingCheck();

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown(signal: string): Promise<void> {
  console.log(`[worker] Received ${signal} — shutting down gracefully…`);

  if (trialCheckTimer) {
    clearInterval(trialCheckTimer);
  }

  // Stop accepting new jobs and wait for the current job to finish
  await worker.close();

  await prisma.$disconnect();
  redisConnection.disconnect();

  console.log("[worker] Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

console.log(
  `[worker] Billr webhook worker started (concurrency=${process.env.WORKER_CONCURRENCY ?? 10})`
);
