import { FastifyPluginAsync } from 'fastify';
import { ActorType, SubscriptionStatus } from '@prisma/client';
import { prisma } from '../lib/db';
import { stripe } from '../lib/stripe';
import { dispatchEvent } from '../services/webhookDispatcher';

const subscriptionsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /v1/subscriptions
   * Creates a subscription. If plan.trial_days > 0, sets status=trialing with trial_end.
   * Creates the corresponding Stripe subscription.
   */
  fastify.post<{
    Body: {
      plan_id: string;
      metadata?: Record<string, unknown>;
    };
  }>(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          required: ['plan_id'],
          properties: {
            plan_id: { type: 'string', format: 'uuid' },
            metadata: { type: 'object' },
          },
        },
      },
    },
    async (request, reply) => {
      const accountId = request.accountId;

      try {
        const [account, plan] = await Promise.all([
          prisma.account.findUnique({ where: { id: accountId } }),
          prisma.plan.findUnique({ where: { id: request.body.plan_id } }),
        ]);

        if (!account) return reply.status(404).send({ error: 'Account not found' });
        if (!plan || !plan.is_active) return reply.status(404).send({ error: 'Plan not found or inactive' });
        if (!account.stripe_customer_id) {
          return reply.status(400).send({ error: 'Account has no Stripe customer. Create a checkout session first.' });
        }

        const now = new Date();
        const hasTrial = plan.trial_days > 0;
        const trialEnd = hasTrial ? new Date(now.getTime() + plan.trial_days * 86400 * 1000) : null;

        // Create Stripe subscription
        let stripeSub;
        try {
          stripeSub = await stripe.subscriptions.create({
            customer: account.stripe_customer_id,
            items: plan.stripe_price_id ? [{ price: plan.stripe_price_id }] : [],
            trial_end: trialEnd ? Math.floor(trialEnd.getTime() / 1000) : undefined,
            payment_behavior: 'default_incomplete',
            expand: ['latest_invoice.payment_intent'],
            metadata: { billr_account_id: accountId, billr_plan_id: plan.id },
          });
        } catch (stripeErr) {
          request.log.error({ stripeErr }, 'Failed to create Stripe subscription');
          return reply.status(502).send({ error: 'Failed to create payment subscription' });
        }

        const currentPeriodStart = new Date(stripeSub.current_period_start * 1000);
        const currentPeriodEnd = new Date(stripeSub.current_period_end * 1000);

        const subscription = await prisma.subscription.create({
          data: {
            account_id: accountId,
            plan_id: plan.id,
            stripe_subscription_id: stripeSub.id,
            status: hasTrial ? 'trialing' : 'active',
            trial_start: hasTrial ? now : null,
            trial_end: trialEnd,
            current_period_start: currentPeriodStart,
            current_period_end: currentPeriodEnd,
            metadata: request.body.metadata ?? {},
          },
          include: { plan: { include: { tiers: true } } },
        });

        await fastify.audit({
          accountId,
          actorType: ActorType.api_key,
          action: 'subscription.created',
          resourceType: 'subscription',
          resourceId: subscription.id,
          request,
          afterState: { plan_id: plan.id, status: subscription.status },
        });

        // Dispatch outbound webhook events
        await dispatchEvent(accountId, 'subscription.created', { subscription });
        if (hasTrial) {
          await dispatchEvent(accountId, 'subscription.trial_started', {
            subscription,
            trial_end: trialEnd?.toISOString(),
          });
        }

        return reply.status(201).send(subscription);
      } catch (err) {
        request.log.error({ err }, 'Failed to create subscription');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * GET /v1/subscriptions
   * Lists subscriptions scoped to the authenticated account.
   */
  fastify.get<{
    Querystring: { status?: SubscriptionStatus; limit?: string; after?: string };
  }>(
    '/',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused'] },
            limit: { type: 'string' },
            after: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const limit = Math.min(parseInt(request.query.limit ?? '20', 10), 100);
        const subscriptions = await prisma.subscription.findMany({
          where: {
            account_id: request.accountId,
            ...(request.query.status && { status: request.query.status }),
            ...(request.query.after && { id: { gt: request.query.after } }),
          },
          include: { plan: true },
          orderBy: { created_at: 'desc' },
          take: limit,
        });
        return reply.send({ data: subscriptions });
      } catch (err) {
        request.log.error({ err }, 'Failed to list subscriptions');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * GET /v1/subscriptions/:subId
   */
  fastify.get<{ Params: { subId: string } }>(
    '/:subId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['subId'],
          properties: { subId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      try {
        const sub = await prisma.subscription.findFirst({
          where: { id: request.params.subId, account_id: request.accountId },
          include: { plan: { include: { tiers: true } } },
        });
        if (!sub) return reply.status(404).send({ error: 'Subscription not found' });
        return reply.send(sub);
      } catch (err) {
        request.log.error({ err }, 'Failed to fetch subscription');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * POST /v1/subscriptions/:subId/upgrade
   * Upgrades plan with immediate proration via Stripe.
   */
  fastify.post<{
    Params: { subId: string };
    Body: { plan_id: string };
  }>(
    '/:subId/upgrade',
    {
      schema: {
        params: {
          type: 'object',
          required: ['subId'],
          properties: { subId: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          required: ['plan_id'],
          properties: { plan_id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      try {
        const [sub, newPlan] = await Promise.all([
          prisma.subscription.findFirst({
            where: { id: request.params.subId, account_id: request.accountId },
          }),
          prisma.plan.findUnique({ where: { id: request.body.plan_id } }),
        ]);

        if (!sub) return reply.status(404).send({ error: 'Subscription not found' });
        if (!newPlan || !newPlan.is_active) return reply.status(404).send({ error: 'Plan not found or inactive' });
        if (!sub.stripe_subscription_id) return reply.status(400).send({ error: 'Subscription has no Stripe ID' });
        if (!newPlan.stripe_price_id) return reply.status(400).send({ error: 'New plan has no Stripe price ID' });

        // Get current Stripe subscription to find the item ID to replace
        const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
        const existingItemId = stripeSub.items.data[0]?.id;

        if (!existingItemId) return reply.status(400).send({ error: 'No subscription item found in Stripe' });

        await stripe.subscriptions.update(sub.stripe_subscription_id, {
          items: [{ id: existingItemId, price: newPlan.stripe_price_id }],
          proration_behavior: 'create_prorations',
        });

        const oldPlanId = sub.plan_id;
        const updated = await prisma.subscription.update({
          where: { id: sub.id },
          data: { plan_id: newPlan.id },
          include: { plan: true },
        });

        await fastify.audit({
          accountId: request.accountId,
          actorType: ActorType.api_key,
          action: 'subscription.upgraded',
          resourceType: 'subscription',
          resourceId: sub.id,
          request,
          beforeState: { plan_id: oldPlanId },
          afterState: { plan_id: newPlan.id },
        });

        await dispatchEvent(request.accountId, 'subscription.upgraded', {
          subscription: updated,
          from_plan_id: oldPlanId,
          to_plan_id: newPlan.id,
        });

        return reply.send(updated);
      } catch (err) {
        request.log.error({ err }, 'Failed to upgrade subscription');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * POST /v1/subscriptions/:subId/downgrade
   * Downgrades plan — applied at period end (proration_behavior: 'none').
   */
  fastify.post<{
    Params: { subId: string };
    Body: { plan_id: string };
  }>(
    '/:subId/downgrade',
    {
      schema: {
        params: {
          type: 'object',
          required: ['subId'],
          properties: { subId: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          required: ['plan_id'],
          properties: { plan_id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      try {
        const [sub, newPlan] = await Promise.all([
          prisma.subscription.findFirst({
            where: { id: request.params.subId, account_id: request.accountId },
          }),
          prisma.plan.findUnique({ where: { id: request.body.plan_id } }),
        ]);

        if (!sub) return reply.status(404).send({ error: 'Subscription not found' });
        if (!newPlan || !newPlan.is_active) return reply.status(404).send({ error: 'Plan not found or inactive' });
        if (!sub.stripe_subscription_id) return reply.status(400).send({ error: 'Subscription has no Stripe ID' });
        if (!newPlan.stripe_price_id) return reply.status(400).send({ error: 'New plan has no Stripe price ID' });

        const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
        const existingItemId = stripeSub.items.data[0]?.id;

        if (!existingItemId) return reply.status(400).send({ error: 'No subscription item found in Stripe' });

        await stripe.subscriptions.update(sub.stripe_subscription_id, {
          items: [{ id: existingItemId, price: newPlan.stripe_price_id }],
          proration_behavior: 'none',
          billing_cycle_anchor: 'unchanged',
        });

        const oldPlanId = sub.plan_id;
        const updated = await prisma.subscription.update({
          where: { id: sub.id },
          data: { plan_id: newPlan.id },
          include: { plan: true },
        });

        await fastify.audit({
          accountId: request.accountId,
          actorType: ActorType.api_key,
          action: 'subscription.downgraded',
          resourceType: 'subscription',
          resourceId: sub.id,
          request,
          beforeState: { plan_id: oldPlanId },
          afterState: { plan_id: newPlan.id },
        });

        await dispatchEvent(request.accountId, 'subscription.downgraded', {
          subscription: updated,
          from_plan_id: oldPlanId,
          to_plan_id: newPlan.id,
        });

        return reply.send(updated);
      } catch (err) {
        request.log.error({ err }, 'Failed to downgrade subscription');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * POST /v1/subscriptions/:subId/cancel
   * Body: { immediately: boolean }
   * If immediately=true: cancel right now via stripe.subscriptions.cancel().
   * If immediately=false: set cancel_at_period_end=true, access continues to period end.
   */
  fastify.post<{
    Params: { subId: string };
    Body: { immediately: boolean };
  }>(
    '/:subId/cancel',
    {
      schema: {
        params: {
          type: 'object',
          required: ['subId'],
          properties: { subId: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          required: ['immediately'],
          properties: { immediately: { type: 'boolean' } },
        },
      },
    },
    async (request, reply) => {
      const { immediately } = request.body;

      try {
        const sub = await prisma.subscription.findFirst({
          where: { id: request.params.subId, account_id: request.accountId },
        });

        if (!sub) return reply.status(404).send({ error: 'Subscription not found' });
        if (sub.status === 'canceled') return reply.status(409).send({ error: 'Subscription already canceled' });
        if (!sub.stripe_subscription_id) return reply.status(400).send({ error: 'Subscription has no Stripe ID' });

        let updated;
        if (immediately) {
          await stripe.subscriptions.cancel(sub.stripe_subscription_id);
          updated = await prisma.subscription.update({
            where: { id: sub.id },
            data: { status: 'canceled', canceled_at: new Date(), ended_at: new Date() },
          });
        } else {
          await stripe.subscriptions.update(sub.stripe_subscription_id, {
            cancel_at_period_end: true,
          });
          updated = await prisma.subscription.update({
            where: { id: sub.id },
            data: { cancel_at_period_end: true, canceled_at: new Date() },
          });
        }

        await fastify.audit({
          accountId: request.accountId,
          actorType: ActorType.api_key,
          action: 'subscription.canceled',
          resourceType: 'subscription',
          resourceId: sub.id,
          request,
          beforeState: { status: sub.status, cancel_at_period_end: sub.cancel_at_period_end },
          afterState: {
            status: updated.status,
            immediately,
            cancel_at_period_end: updated.cancel_at_period_end,
          },
        });

        await dispatchEvent(request.accountId, 'subscription.canceled', {
          subscription: updated,
          immediately,
          access_until: immediately ? new Date().toISOString() : sub.current_period_end.toISOString(),
        });

        return reply.send(updated);
      } catch (err) {
        request.log.error({ err }, 'Failed to cancel subscription');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * POST /v1/subscriptions/:subId/reactivate
   * Removes cancel_at_period_end — subscription will renew at period end.
   */
  fastify.post<{ Params: { subId: string } }>(
    '/:subId/reactivate',
    {
      schema: {
        params: {
          type: 'object',
          required: ['subId'],
          properties: { subId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      try {
        const sub = await prisma.subscription.findFirst({
          where: { id: request.params.subId, account_id: request.accountId },
        });

        if (!sub) return reply.status(404).send({ error: 'Subscription not found' });
        if (!sub.cancel_at_period_end) {
          return reply.status(409).send({ error: 'Subscription is not scheduled for cancellation' });
        }
        if (!sub.stripe_subscription_id) return reply.status(400).send({ error: 'Subscription has no Stripe ID' });

        await stripe.subscriptions.update(sub.stripe_subscription_id, {
          cancel_at_period_end: false,
        });

        const updated = await prisma.subscription.update({
          where: { id: sub.id },
          data: { cancel_at_period_end: false, canceled_at: null },
        });

        await fastify.audit({
          accountId: request.accountId,
          actorType: ActorType.api_key,
          action: 'subscription.reactivated',
          resourceType: 'subscription',
          resourceId: sub.id,
          request,
          beforeState: { cancel_at_period_end: true },
          afterState: { cancel_at_period_end: false },
        });

        await dispatchEvent(request.accountId, 'subscription.reactivated', { subscription: updated });

        return reply.send(updated);
      } catch (err) {
        request.log.error({ err }, 'Failed to reactivate subscription');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * GET /v1/subscriptions/:subId/usage
   * Returns usage summary grouped by metric for the current billing period.
   */
  fastify.get<{ Params: { subId: string } }>(
    '/:subId/usage',
    {
      schema: {
        params: {
          type: 'object',
          required: ['subId'],
          properties: { subId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      try {
        const sub = await prisma.subscription.findFirst({
          where: { id: request.params.subId, account_id: request.accountId },
        });
        if (!sub) return reply.status(404).send({ error: 'Subscription not found' });

        // Aggregate usage within the current billing period
        const records = await prisma.usageRecord.groupBy({
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
          usage: records.map((r) => ({
            metric: r.metric,
            total_quantity: r._sum.quantity?.toString() ?? '0',
            record_count: r._count.id,
          })),
        });
      } catch (err) {
        request.log.error({ err }, 'Failed to fetch subscription usage');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
};

export default subscriptionsRoutes;
