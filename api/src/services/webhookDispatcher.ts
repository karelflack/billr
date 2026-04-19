import { randomUUID } from 'crypto';
import { prisma } from '../lib/db';
import { webhookQueue } from '../lib/queue';

/**
 * Dispatches a Billr event to all active webhook endpoints registered by an account.
 *
 * For each matching endpoint:
 * 1. A webhook_deliveries record is created with status=pending.
 * 2. A BullMQ job is enqueued with the delivery details.
 *
 * This function never throws — delivery failures are handled by the worker.
 * Errors here are logged but do not affect the calling request.
 */
export async function dispatchEvent(
  accountId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  // A single UUID scopes the logical event — all deliveries for this event share it.
  // This allows replay to link new deliveries back to the original event.
  const eventId = randomUUID();

  let endpoints;
  try {
    // Find all active endpoints subscribed to this event type.
    // Postgres array containment operator @> checks if the events[] column
    // contains the given event type string.
    endpoints = await prisma.webhookEndpoint.findMany({
      where: {
        account_id: accountId,
        is_active: true,
        events: { has: eventType },
      },
      select: {
        id: true,
        url: true,
        secret_encrypted: true,
      },
    });
  } catch (err) {
    console.error('[webhookDispatcher] Failed to query endpoints:', err);
    return;
  }

  if (endpoints.length === 0) return;

  // Fan-out: create one delivery record + one BullMQ job per endpoint
  for (const endpoint of endpoints) {
    try {
      const delivery = await prisma.webhookDelivery.create({
        data: {
          endpoint_id: endpoint.id,
          account_id: accountId,
          event_type: eventType,
          event_id: eventId,
          payload: {
            id: eventId,
            type: eventType,
            created: Math.floor(Date.now() / 1000),
            data: payload,
          },
          status: 'pending',
        },
      });

      await webhookQueue.add('deliver', {
        deliveryId: delivery.id,
        endpointUrl: endpoint.url,
        secretEncrypted: endpoint.secret_encrypted,
        eventType,
        payload: delivery.payload as Record<string, unknown>,
        accountId,
      });
    } catch (err) {
      // Log per-endpoint failures but continue fan-out to other endpoints
      console.error('[webhookDispatcher] Failed to create delivery for endpoint', endpoint.id, err);
    }
  }
}
