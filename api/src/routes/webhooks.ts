import { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'crypto';
import { ActorType } from '@prisma/client';
import { prisma } from '../lib/db';
import { encrypt, generateSecret } from '../lib/crypto';
import { webhookQueue } from '../lib/queue';
import { dispatchEvent } from '../services/webhookDispatcher';

const webhooksRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /v1/webhooks
   * Registers a new webhook endpoint.
   * The plaintext secret is returned ONCE in the response — it is never retrievable again.
   */
  fastify.post<{
    Body: {
      url: string;
      events: string[];
      description?: string;
    };
  }>(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          required: ['url', 'events'],
          properties: {
            url: { type: 'string', format: 'uri', maxLength: 2048 },
            events: { type: 'array', items: { type: 'string' }, minItems: 1 },
            description: { type: 'string', maxLength: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const plaintextSecret = generateSecret();
        const secretEncrypted = encrypt(plaintextSecret);

        const endpoint = await prisma.webhookEndpoint.create({
          data: {
            account_id: request.accountId,
            url: request.body.url,
            secret_encrypted: secretEncrypted,
            events: request.body.events,
            description: request.body.description ?? null,
          },
        });

        await fastify.audit({
          accountId: request.accountId,
          actorType: ActorType.api_key,
          action: 'webhook_endpoint.created',
          resourceType: 'webhook_endpoint',
          resourceId: endpoint.id,
          request,
          afterState: { url: endpoint.url, events: endpoint.events },
        });

        // Return the plaintext secret once — not stored anywhere retrievable
        return reply.status(201).send({
          id: endpoint.id,
          url: endpoint.url,
          events: endpoint.events,
          description: endpoint.description,
          is_active: endpoint.is_active,
          created_at: endpoint.created_at,
          secret: plaintextSecret, // ONLY time this is returned
        });
      } catch (err) {
        request.log.error({ err }, 'Failed to create webhook endpoint');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * GET /v1/webhooks
   * Lists webhook endpoints. Secret is NEVER included.
   */
  fastify.get('/', async (request, reply) => {
    try {
      const endpoints = await prisma.webhookEndpoint.findMany({
        where: { account_id: request.accountId },
        select: {
          id: true,
          url: true,
          events: true,
          is_active: true,
          description: true,
          created_at: true,
          updated_at: true,
          // secret_encrypted intentionally excluded
        },
        orderBy: { created_at: 'desc' },
      });
      return reply.send({ data: endpoints });
    } catch (err) {
      request.log.error({ err }, 'Failed to list webhook endpoints');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /v1/webhooks/:endpointId
   * Returns a single endpoint. Secret always redacted.
   */
  fastify.get<{ Params: { endpointId: string } }>(
    '/:endpointId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['endpointId'],
          properties: { endpointId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      try {
        const endpoint = await prisma.webhookEndpoint.findFirst({
          where: { id: request.params.endpointId, account_id: request.accountId },
          select: {
            id: true,
            url: true,
            events: true,
            is_active: true,
            description: true,
            created_at: true,
            updated_at: true,
          },
        });
        if (!endpoint) return reply.status(404).send({ error: 'Webhook endpoint not found' });
        return reply.send(endpoint);
      } catch (err) {
        request.log.error({ err }, 'Failed to fetch webhook endpoint');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * PATCH /v1/webhooks/:endpointId
   * Updates url, events, is_active, or description.
   * If body.rotate_secret=true, generates a new secret and returns it once.
   */
  fastify.patch<{
    Params: { endpointId: string };
    Body: {
      url?: string;
      events?: string[];
      is_active?: boolean;
      description?: string;
      rotate_secret?: boolean;
    };
  }>(
    '/:endpointId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['endpointId'],
          properties: { endpointId: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          properties: {
            url: { type: 'string', format: 'uri', maxLength: 2048 },
            events: { type: 'array', items: { type: 'string' }, minItems: 1 },
            is_active: { type: 'boolean' },
            description: { type: 'string', maxLength: 500 },
            rotate_secret: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const existing = await prisma.webhookEndpoint.findFirst({
          where: { id: request.params.endpointId, account_id: request.accountId },
        });
        if (!existing) return reply.status(404).send({ error: 'Webhook endpoint not found' });

        let newPlaintextSecret: string | undefined;
        let secretEncrypted: string | undefined;

        if (request.body.rotate_secret) {
          newPlaintextSecret = generateSecret();
          secretEncrypted = encrypt(newPlaintextSecret);
        }

        const updated = await prisma.webhookEndpoint.update({
          where: { id: request.params.endpointId },
          data: {
            ...(request.body.url !== undefined && { url: request.body.url }),
            ...(request.body.events !== undefined && { events: request.body.events }),
            ...(request.body.is_active !== undefined && { is_active: request.body.is_active }),
            ...(request.body.description !== undefined && { description: request.body.description }),
            ...(secretEncrypted !== undefined && { secret_encrypted: secretEncrypted }),
          },
          select: {
            id: true,
            url: true,
            events: true,
            is_active: true,
            description: true,
            created_at: true,
            updated_at: true,
          },
        });

        await fastify.audit({
          accountId: request.accountId,
          actorType: ActorType.api_key,
          action: 'webhook_endpoint.updated',
          resourceType: 'webhook_endpoint',
          resourceId: updated.id,
          request,
          afterState: {
            url: updated.url,
            is_active: updated.is_active,
            secret_rotated: request.body.rotate_secret ?? false,
          },
        });

        return reply.send({
          ...updated,
          ...(newPlaintextSecret !== undefined && { secret: newPlaintextSecret }), // Only if rotated
        });
      } catch (err) {
        request.log.error({ err }, 'Failed to update webhook endpoint');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * DELETE /v1/webhooks/:endpointId
   */
  fastify.delete<{ Params: { endpointId: string } }>(
    '/:endpointId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['endpointId'],
          properties: { endpointId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      try {
        const existing = await prisma.webhookEndpoint.findFirst({
          where: { id: request.params.endpointId, account_id: request.accountId },
        });
        if (!existing) return reply.status(404).send({ error: 'Webhook endpoint not found' });

        await prisma.webhookEndpoint.delete({ where: { id: request.params.endpointId } });

        await fastify.audit({
          accountId: request.accountId,
          actorType: ActorType.api_key,
          action: 'webhook_endpoint.deleted',
          resourceType: 'webhook_endpoint',
          resourceId: request.params.endpointId,
          request,
        });

        return reply.status(204).send();
      } catch (err) {
        request.log.error({ err }, 'Failed to delete webhook endpoint');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * GET /v1/webhooks/:endpointId/deliveries
   * Lists delivery history for an endpoint.
   */
  fastify.get<{
    Params: { endpointId: string };
    Querystring: { status?: string; limit?: string; after?: string };
  }>(
    '/:endpointId/deliveries',
    {
      schema: {
        params: {
          type: 'object',
          required: ['endpointId'],
          properties: { endpointId: { type: 'string', format: 'uuid' } },
        },
        querystring: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['pending', 'delivered', 'failed', 'dead'] },
            limit: { type: 'string' },
            after: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        // Verify endpoint belongs to account
        const endpoint = await prisma.webhookEndpoint.findFirst({
          where: { id: request.params.endpointId, account_id: request.accountId },
          select: { id: true },
        });
        if (!endpoint) return reply.status(404).send({ error: 'Webhook endpoint not found' });

        const limit = Math.min(parseInt(request.query.limit ?? '20', 10), 100);

        const deliveries = await prisma.webhookDelivery.findMany({
          where: {
            endpoint_id: request.params.endpointId,
            ...(request.query.status && { status: request.query.status as 'pending' | 'delivered' | 'failed' | 'dead' }),
            ...(request.query.after && { id: { gt: request.query.after } }),
          },
          select: {
            id: true,
            event_type: true,
            event_id: true,
            status: true,
            attempt_count: true,
            last_attempt_at: true,
            next_attempt_at: true,
            response_status: true,
            error_message: true,
            created_at: true,
            // payload omitted by default for brevity; callers can use /invoices/:id if needed
          },
          orderBy: { created_at: 'desc' },
          take: limit,
        });

        return reply.send({ data: deliveries });
      } catch (err) {
        request.log.error({ err }, 'Failed to list webhook deliveries');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * POST /v1/webhooks/deliveries/:deliveryId/replay
   * Creates a NEW delivery record and BullMQ job for the same event.
   * Does not reset attempt_count on the original record.
   */
  fastify.post<{ Params: { deliveryId: string } }>(
    '/deliveries/:deliveryId/replay',
    {
      schema: {
        params: {
          type: 'object',
          required: ['deliveryId'],
          properties: { deliveryId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      try {
        // Find the original delivery and verify account ownership via the endpoint
        const original = await prisma.webhookDelivery.findFirst({
          where: {
            id: request.params.deliveryId,
            account_id: request.accountId,
          },
          include: {
            endpoint: {
              select: { id: true, url: true, secret_encrypted: true, is_active: true },
            },
          },
        });

        if (!original) return reply.status(404).send({ error: 'Delivery record not found' });
        if (!original.endpoint.is_active) {
          return reply.status(400).send({ error: 'Webhook endpoint is inactive' });
        }

        // Create a new delivery record linked to the same event_id
        const newDelivery = await prisma.webhookDelivery.create({
          data: {
            endpoint_id: original.endpoint_id,
            account_id: original.account_id,
            event_type: original.event_type,
            event_id: original.event_id,
            payload: original.payload as Record<string, unknown>,
            status: 'pending',
          },
        });

        // Enqueue a fresh BullMQ job
        await webhookQueue.add('deliver', {
          deliveryId: newDelivery.id,
          endpointUrl: original.endpoint.url,
          secretEncrypted: original.endpoint.secret_encrypted,
          eventType: original.event_type,
          payload: original.payload as Record<string, unknown>,
          accountId: original.account_id,
        });

        await fastify.audit({
          accountId: request.accountId,
          actorType: ActorType.api_key,
          action: 'webhook_delivery.replayed',
          resourceType: 'webhook_delivery',
          resourceId: newDelivery.id,
          request,
          afterState: { original_delivery_id: original.id, new_delivery_id: newDelivery.id },
        });

        return reply.status(201).send(newDelivery);
      } catch (err) {
        request.log.error({ err }, 'Failed to replay webhook delivery');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
};

export default webhooksRoutes;
