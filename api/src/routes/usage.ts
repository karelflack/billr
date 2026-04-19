import { FastifyPluginAsync } from 'fastify';
import { ActorType } from '@prisma/client';
import { prisma } from '../lib/db';

const usageRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /v1/usage
   * Records a usage event. Idempotency key prevents double-counting on retries.
   * On duplicate idempotency_key, returns 200 silently (not an error).
   */
  fastify.post<{
    Body: {
      subscription_id: string;
      metric: string;
      quantity: number;
      idempotency_key: string;
      source?: string;
      recorded_at?: string;
    };
  }>(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          required: ['subscription_id', 'metric', 'quantity', 'idempotency_key'],
          properties: {
            subscription_id: { type: 'string', format: 'uuid' },
            metric: { type: 'string', minLength: 1, maxLength: 100 },
            quantity: { type: 'number', exclusiveMinimum: 0 },
            idempotency_key: { type: 'string', minLength: 1, maxLength: 255 },
            source: { type: 'string', maxLength: 100 },
            recorded_at: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    async (request, reply) => {
      const { subscription_id, metric, quantity, idempotency_key, source, recorded_at } = request.body;

      try {
        // Verify the subscription belongs to this account
        const sub = await prisma.subscription.findFirst({
          where: { id: subscription_id, account_id: request.accountId },
        });
        if (!sub) return reply.status(404).send({ error: 'Subscription not found' });

        // Upsert by idempotency_key — duplicate keys are silently ignored
        const record = await prisma.usageRecord.upsert({
          where: { idempotency_key },
          create: {
            subscription_id,
            account_id: request.accountId,
            metric,
            quantity: quantity.toString(),
            idempotency_key,
            source: source ?? null,
            recorded_at: recorded_at ? new Date(recorded_at) : new Date(),
          },
          update: {}, // No-op on duplicate — idempotent
        });

        return reply.status(200).send(record);
      } catch (err) {
        request.log.error({ err }, 'Failed to record usage');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * GET /v1/usage
   * Lists usage records with cursor pagination.
   * Filters: subscription_id, metric, start (date-time), end (date-time), limit, after (cursor).
   */
  fastify.get<{
    Querystring: {
      subscription_id?: string;
      metric?: string;
      start?: string;
      end?: string;
      limit?: string;
      after?: string;
    };
  }>(
    '/',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            subscription_id: { type: 'string', format: 'uuid' },
            metric: { type: 'string' },
            start: { type: 'string', format: 'date-time' },
            end: { type: 'string', format: 'date-time' },
            limit: { type: 'string' },
            after: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const limit = Math.min(parseInt(request.query.limit ?? '50', 10), 100);

        const records = await prisma.usageRecord.findMany({
          where: {
            account_id: request.accountId,
            ...(request.query.subscription_id && { subscription_id: request.query.subscription_id }),
            ...(request.query.metric && { metric: request.query.metric }),
            ...(request.query.start || request.query.end
              ? {
                  recorded_at: {
                    ...(request.query.start && { gte: new Date(request.query.start) }),
                    ...(request.query.end && { lte: new Date(request.query.end) }),
                  },
                }
              : {}),
            ...(request.query.after && { id: { gt: request.query.after } }),
          },
          orderBy: { recorded_at: 'desc' },
          take: limit,
        });

        return reply.send({ data: records });
      } catch (err) {
        request.log.error({ err }, 'Failed to list usage records');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * GET /v1/usage/summary
   * Returns aggregated totals by metric for a subscription's current period.
   * Required query param: subscription_id
   */
  fastify.get<{
    Querystring: { subscription_id: string };
  }>(
    '/summary',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['subscription_id'],
          properties: {
            subscription_id: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const sub = await prisma.subscription.findFirst({
          where: { id: request.query.subscription_id, account_id: request.accountId },
        });
        if (!sub) return reply.status(404).send({ error: 'Subscription not found' });

        const summary = await prisma.usageRecord.groupBy({
          by: ['metric'],
          where: {
            subscription_id: sub.id,
            recorded_at: {
              gte: sub.current_period_start,
              lte: sub.current_period_end,
            },
          },
          _sum: { quantity: true },
          _count: { id: true },
        });

        return reply.send({
          subscription_id: sub.id,
          period_start: sub.current_period_start,
          period_end: sub.current_period_end,
          metrics: summary.map((s) => ({
            metric: s.metric,
            total: s._sum.quantity?.toString() ?? '0',
            event_count: s._count.id,
          })),
        });
      } catch (err) {
        request.log.error({ err }, 'Failed to fetch usage summary');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
};

export default usageRoutes;
