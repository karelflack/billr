import { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'crypto';
import { ActorType } from '@prisma/client';
import { prisma } from '../lib/db';
import { stripe } from '../lib/stripe';
import { dispatchEvent } from '../services/webhookDispatcher';

const accountsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /v1/accounts
   * Creates a new account and a corresponding Stripe customer.
   * This route is PUBLIC (no auth required) to support self-service signup.
   */
  fastify.post<{
    Body: {
      name: string;
      email: string;
      billing_email?: string;
      currency?: string;
      timezone?: string;
      metadata?: Record<string, unknown>;
    };
  }>(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name', 'email'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 255 },
            email: { type: 'string', format: 'email' },
            billing_email: { type: 'string', format: 'email' },
            currency: { type: 'string', minLength: 3, maxLength: 3 },
            timezone: { type: 'string', maxLength: 100 },
            metadata: { type: 'object' },
          },
        },
      },
    },
    async (request, reply) => {
      const { name, email, billing_email, currency = 'USD', timezone = 'UTC', metadata = {} } = request.body;

      try {
        // Check for duplicate email
        const existing = await prisma.account.findUnique({ where: { email } });
        if (existing) {
          return reply.status(409).send({ error: 'An account with this email already exists' });
        }

        // Create Stripe customer first so we can store the ID atomically with the account
        let stripeCustomerId: string | null = null;
        try {
          const customer = await stripe.customers.create({
            email,
            name,
            metadata: { billr_currency: currency },
          });
          stripeCustomerId = customer.id;
        } catch (stripeErr) {
          request.log.error({ stripeErr }, 'Failed to create Stripe customer');
          // Non-fatal: account can be created without a Stripe customer and retried later
        }

        const account = await prisma.account.create({
          data: {
            name,
            email,
            billing_email: billing_email ?? null,
            stripe_customer_id: stripeCustomerId,
            currency,
            timezone,
            metadata,
          },
        });

        await fastify.audit({
          accountId: account.id,
          actorType: ActorType.system,
          action: 'account.created',
          resourceType: 'account',
          resourceId: account.id,
          request,
          afterState: { id: account.id, email, name },
        });

        await dispatchEvent(account.id, 'account.created', { account });

        return reply.status(201).send(account);
      } catch (err) {
        request.log.error({ err }, 'Failed to create account');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * GET /v1/accounts/:accountId
   * Returns the account. RLS enforced: request.accountId must match the path param.
   */
  fastify.get<{ Params: { accountId: string } }>(
    '/:accountId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['accountId'],
          properties: { accountId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      if (request.params.accountId !== request.accountId) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      try {
        const account = await prisma.account.findUnique({
          where: { id: request.params.accountId },
        });
        if (!account) return reply.status(404).send({ error: 'Account not found' });
        return reply.send(account);
      } catch (err) {
        request.log.error({ err }, 'Failed to fetch account');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * PATCH /v1/accounts/:accountId
   * Updates mutable fields: name, billing_email, metadata.
   */
  fastify.patch<{
    Params: { accountId: string };
    Body: { name?: string; billing_email?: string; metadata?: Record<string, unknown> };
  }>(
    '/:accountId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['accountId'],
          properties: { accountId: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 255 },
            billing_email: { type: 'string', format: 'email' },
            metadata: { type: 'object' },
          },
        },
      },
    },
    async (request, reply) => {
      if (request.params.accountId !== request.accountId) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      try {
        const before = await prisma.account.findUnique({ where: { id: request.params.accountId } });
        if (!before) return reply.status(404).send({ error: 'Account not found' });

        const updated = await prisma.account.update({
          where: { id: request.params.accountId },
          data: {
            ...(request.body.name !== undefined && { name: request.body.name }),
            ...(request.body.billing_email !== undefined && { billing_email: request.body.billing_email }),
            ...(request.body.metadata !== undefined && { metadata: request.body.metadata }),
          },
        });

        await fastify.audit({
          accountId: request.accountId,
          actorType: ActorType.api_key,
          action: 'account.updated',
          resourceType: 'account',
          resourceId: updated.id,
          request,
          beforeState: { name: before.name, billing_email: before.billing_email },
          afterState: { name: updated.name, billing_email: updated.billing_email },
        });

        return reply.send(updated);
      } catch (err) {
        request.log.error({ err }, 'Failed to update account');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * DELETE /v1/accounts/:accountId
   * Soft-delete: anonymises PII fields. Invoices are retained for tax compliance.
   */
  fastify.delete<{ Params: { accountId: string } }>(
    '/:accountId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['accountId'],
          properties: { accountId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      if (request.params.accountId !== request.accountId) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      try {
        const account = await prisma.account.findUnique({ where: { id: request.params.accountId } });
        if (!account) return reply.status(404).send({ error: 'Account not found' });

        const deletionUuid = randomUUID();
        await prisma.account.update({
          where: { id: request.params.accountId },
          data: {
            name: '[deleted]',
            email: `deleted_${deletionUuid}@deleted.billr.io`,
            billing_email: null,
          },
        });

        await fastify.audit({
          accountId: request.accountId,
          actorType: ActorType.api_key,
          action: 'account.deleted',
          resourceType: 'account',
          resourceId: request.params.accountId,
          request,
          beforeState: { email: account.email, name: account.name },
          afterState: { anonymised: true },
        });

        return reply.status(204).send();
      } catch (err) {
        request.log.error({ err }, 'Failed to delete account');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * POST /v1/accounts/:accountId/data-export
   * LB-006: GDPR Art.15/20 — Right of Access + Data Portability.
   * Rate limited to 1 request per 24 hours per account via Redis.
   */
  fastify.post<{ Params: { accountId: string } }>(
    '/:accountId/data-export',
    {
      schema: {
        params: {
          type: 'object',
          required: ['accountId'],
          properties: { accountId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      if (request.params.accountId !== request.accountId) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      // Enforce 1-per-24h rate limit via Redis (separate from API rate limit)
      const { redis: redisClient } = await import('../lib/redis');
      const rateLimitKey = `data_export:${request.accountId}`;
      const existing = await redisClient.get(rateLimitKey);
      if (existing) {
        return reply.status(429).send({ error: 'Data export already requested. Please wait 24 hours.' });
      }
      // TTL = 86400 seconds (24 hours)
      await redisClient.set(rateLimitKey, '1', 'EX', 86400);

      try {
        // Fetch all data categories for this account
        const [account, subscriptions, invoices, usageRecords, webhookEndpoints] = await Promise.all([
          prisma.account.findUnique({ where: { id: request.accountId } }),
          prisma.subscription.findMany({ where: { account_id: request.accountId } }),
          prisma.invoice.findMany({
            where: { account_id: request.accountId },
            include: { lineItems: true },
          }),
          prisma.usageRecord.findMany({ where: { account_id: request.accountId } }),
          prisma.webhookEndpoint.findMany({
            where: { account_id: request.accountId },
            select: { id: true, url: true, events: true, is_active: true, created_at: true },
          }),
        ]);

        await fastify.audit({
          accountId: request.accountId,
          actorType: ActorType.api_key,
          action: 'account.data_export_requested',
          resourceType: 'account',
          resourceId: request.accountId,
          request,
        });

        const exportData = {
          exported_at: new Date().toISOString(),
          account,
          subscriptions,
          invoices,
          usage_records: usageRecords,
          webhook_endpoints: webhookEndpoints,
        };

        return reply.status(200).send(exportData);
      } catch (err) {
        request.log.error({ err }, 'Failed to generate data export');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * POST /v1/accounts/:accountId/delete
   * LB-007: GDPR Art.17 — Right to Erasure.
   * Cancels subscriptions, anonymises PII, retains invoices, logs deletion.
   * LB-011: Deletion is logged to a separate deletion audit entry.
   */
  fastify.post<{ Params: { accountId: string } }>(
    '/:accountId/delete',
    {
      schema: {
        params: {
          type: 'object',
          required: ['accountId'],
          properties: { accountId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      if (request.params.accountId !== request.accountId) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      try {
        const account = await prisma.account.findUnique({
          where: { id: request.params.accountId },
          include: {
            subscriptions: { where: { status: { in: ['active', 'trialing', 'past_due', 'paused'] } } },
          },
        });

        if (!account) return reply.status(404).send({ error: 'Account not found' });

        // 1. Cancel all active Stripe subscriptions
        for (const sub of account.subscriptions) {
          if (sub.stripe_subscription_id) {
            try {
              await stripe.subscriptions.cancel(sub.stripe_subscription_id);
            } catch (stripeErr) {
              request.log.error({ stripeErr, subId: sub.id }, 'Failed to cancel Stripe subscription during erasure');
            }
          }
          await prisma.subscription.update({
            where: { id: sub.id },
            data: { status: 'canceled', ended_at: new Date(), canceled_at: new Date() },
          });
        }

        // 2. Delete webhook endpoints
        await prisma.webhookEndpoint.deleteMany({ where: { account_id: request.accountId } });

        // 3. Anonymise account PII — retain the account row for FK integrity on invoices
        const deletionUuid = randomUUID();
        const originalEmail = account.email;
        await prisma.account.update({
          where: { id: request.accountId },
          data: {
            name: '[deleted]',
            email: `deleted_${deletionUuid}@deleted.billr.io`,
            billing_email: null,
            stripe_customer_id: null,
            metadata: {},
          },
        });

        // 4. LB-011: Separate deletion audit log entry — not subject to erasure
        await fastify.audit({
          accountId: request.accountId,
          actorType: ActorType.api_key,
          action: 'account.gdpr_erasure',
          resourceType: 'account',
          resourceId: request.accountId,
          request,
          beforeState: {
            email: originalEmail,
            name: account.name,
            subscriptions_canceled: account.subscriptions.length,
          },
          afterState: {
            anonymised: true,
            invoices_retained: true,
            deletion_timestamp: new Date().toISOString(),
          },
        });

        return reply.status(200).send({
          message: 'Account deleted. Personal data has been anonymised. Invoices retained per legal requirement.',
          deleted_at: new Date().toISOString(),
        });
      } catch (err) {
        request.log.error({ err }, 'Failed to process GDPR erasure');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
};

export default accountsRoutes;
