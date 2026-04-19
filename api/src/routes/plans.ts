import { FastifyPluginAsync } from 'fastify';
import { ActorType, BillingInterval } from '@prisma/client';
import { prisma } from '../lib/db';

const plansRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /v1/plans
   * Public — no auth required. Returns all active plans with their pricing tiers.
   */
  fastify.get('/', async (request, reply) => {
    try {
      const plans = await prisma.plan.findMany({
        where: { is_active: true },
        include: { tiers: { orderBy: { up_to: 'asc' } } },
        orderBy: { created_at: 'asc' },
      });
      return reply.send({ data: plans });
    } catch (err) {
      request.log.error({ err }, 'Failed to list plans');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /v1/plans/:planId
   * Returns a single plan with tiers. Public.
   */
  fastify.get<{ Params: { planId: string } }>(
    '/:planId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['planId'],
          properties: { planId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      try {
        const plan = await prisma.plan.findUnique({
          where: { id: request.params.planId },
          include: { tiers: { orderBy: { up_to: 'asc' } } },
        });
        if (!plan) return reply.status(404).send({ error: 'Plan not found' });
        return reply.send(plan);
      } catch (err) {
        request.log.error({ err }, 'Failed to fetch plan');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * POST /v1/plans
   * Creates a new plan. Admin scope required.
   */
  fastify.post<{
    Body: {
      name: string;
      slug: string;
      billing_interval: BillingInterval;
      base_price: string;
      description?: string;
      trial_days?: number;
      stripe_price_id?: string;
      metadata?: Record<string, unknown>;
    };
  }>(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name', 'slug', 'billing_interval', 'base_price'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 255 },
            slug: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[a-z0-9-]+$' },
            billing_interval: { type: 'string', enum: ['monthly', 'annual'] },
            base_price: { type: 'string', pattern: '^[0-9]+(\\.[0-9]+)?$' },
            description: { type: 'string' },
            trial_days: { type: 'integer', minimum: 0 },
            stripe_price_id: { type: 'string' },
            metadata: { type: 'object' },
          },
        },
      },
    },
    async (request, reply) => {
      if (request.apiScope !== 'admin') {
        return reply.status(403).send({ error: 'Admin scope required' });
      }

      try {
        const plan = await prisma.plan.create({
          data: {
            name: request.body.name,
            slug: request.body.slug,
            billing_interval: request.body.billing_interval,
            base_price: request.body.base_price,
            description: request.body.description ?? null,
            trial_days: request.body.trial_days ?? 0,
            stripe_price_id: request.body.stripe_price_id ?? null,
            metadata: request.body.metadata ?? {},
          },
          include: { tiers: true },
        });

        await fastify.audit({
          accountId: request.accountId,
          actorType: ActorType.api_key,
          action: 'plan.created',
          resourceType: 'plan',
          resourceId: plan.id,
          request,
          afterState: { id: plan.id, slug: plan.slug, base_price: plan.base_price.toString() },
        });

        return reply.status(201).send(plan);
      } catch (err: unknown) {
        // Unique constraint on slug
        if (isUniqueConstraintError(err)) {
          return reply.status(409).send({ error: 'A plan with this slug already exists' });
        }
        request.log.error({ err }, 'Failed to create plan');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * PATCH /v1/plans/:planId
   * Updates plan fields. Admin scope required.
   * Does NOT retroactively affect active subscriptions.
   */
  fastify.patch<{
    Params: { planId: string };
    Body: {
      name?: string;
      description?: string;
      trial_days?: number;
      stripe_price_id?: string;
      metadata?: Record<string, unknown>;
    };
  }>(
    '/:planId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['planId'],
          properties: { planId: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 255 },
            description: { type: 'string' },
            trial_days: { type: 'integer', minimum: 0 },
            stripe_price_id: { type: 'string' },
            metadata: { type: 'object' },
          },
        },
      },
    },
    async (request, reply) => {
      if (request.apiScope !== 'admin') {
        return reply.status(403).send({ error: 'Admin scope required' });
      }

      try {
        const before = await prisma.plan.findUnique({ where: { id: request.params.planId } });
        if (!before) return reply.status(404).send({ error: 'Plan not found' });

        const updated = await prisma.plan.update({
          where: { id: request.params.planId },
          data: {
            ...(request.body.name !== undefined && { name: request.body.name }),
            ...(request.body.description !== undefined && { description: request.body.description }),
            ...(request.body.trial_days !== undefined && { trial_days: request.body.trial_days }),
            ...(request.body.stripe_price_id !== undefined && { stripe_price_id: request.body.stripe_price_id }),
            ...(request.body.metadata !== undefined && { metadata: request.body.metadata }),
          },
          include: { tiers: true },
        });

        await fastify.audit({
          accountId: request.accountId,
          actorType: ActorType.api_key,
          action: 'plan.updated',
          resourceType: 'plan',
          resourceId: updated.id,
          request,
          beforeState: { name: before.name, trial_days: before.trial_days },
          afterState: { name: updated.name, trial_days: updated.trial_days },
        });

        return reply.send(updated);
      } catch (err) {
        request.log.error({ err }, 'Failed to update plan');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * DELETE /v1/plans/:planId
   * Soft-deactivates the plan (sets is_active=false).
   * Existing subscriptions on this plan are unaffected.
   */
  fastify.delete<{ Params: { planId: string } }>(
    '/:planId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['planId'],
          properties: { planId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      if (request.apiScope !== 'admin') {
        return reply.status(403).send({ error: 'Admin scope required' });
      }

      try {
        const plan = await prisma.plan.findUnique({ where: { id: request.params.planId } });
        if (!plan) return reply.status(404).send({ error: 'Plan not found' });

        await prisma.plan.update({
          where: { id: request.params.planId },
          data: { is_active: false },
        });

        await fastify.audit({
          accountId: request.accountId,
          actorType: ActorType.api_key,
          action: 'plan.deactivated',
          resourceType: 'plan',
          resourceId: plan.id,
          request,
          beforeState: { is_active: true },
          afterState: { is_active: false },
        });

        return reply.status(204).send();
      } catch (err) {
        request.log.error({ err }, 'Failed to deactivate plan');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
};

function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'P2002'
  );
}

export default plansRoutes;
