import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/db';
import { stripe } from '../lib/stripe';

const billingRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /v1/billing/checkout
   * Creates a Stripe Checkout Session for initial payment capture.
   * Returns { url } for client-side redirect.
   */
  fastify.post<{
    Body: {
      plan_id: string;
      success_url?: string;
      cancel_url?: string;
    };
  }>(
    '/checkout',
    {
      schema: {
        body: {
          type: 'object',
          required: ['plan_id'],
          properties: {
            plan_id: { type: 'string', format: 'uuid' },
            success_url: { type: 'string', format: 'uri' },
            cancel_url: { type: 'string', format: 'uri' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const [account, plan] = await Promise.all([
          prisma.account.findUnique({ where: { id: request.accountId } }),
          prisma.plan.findUnique({ where: { id: request.body.plan_id } }),
        ]);

        if (!account) return reply.status(404).send({ error: 'Account not found' });
        if (!plan || !plan.is_active) return reply.status(404).send({ error: 'Plan not found or inactive' });
        if (!plan.stripe_price_id) return reply.status(400).send({ error: 'Plan has no Stripe price configured' });

        const frontendUrl = process.env.FRONTEND_URL ?? 'https://billr.io';

        const session = await stripe.checkout.sessions.create({
          customer: account.stripe_customer_id ?? undefined,
          customer_email: account.stripe_customer_id ? undefined : account.email,
          mode: 'subscription',
          line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
          success_url:
            request.body.success_url ??
            `${frontendUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: request.body.cancel_url ?? `${frontendUrl}/billing/plans`,
          metadata: {
            billr_account_id: request.accountId,
            billr_plan_id: plan.id,
          },
        });

        return reply.send({ url: session.url });
      } catch (err) {
        request.log.error({ err }, 'Failed to create checkout session');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * POST /v1/billing/portal
   * Creates a Stripe Customer Portal session for self-serve subscription management.
   * Returns { url } for client-side redirect.
   */
  fastify.post<{
    Body: { return_url?: string };
  }>(
    '/portal',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            return_url: { type: 'string', format: 'uri' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const account = await prisma.account.findUnique({ where: { id: request.accountId } });
        if (!account) return reply.status(404).send({ error: 'Account not found' });
        if (!account.stripe_customer_id) {
          return reply.status(400).send({ error: 'Account has no Stripe customer' });
        }

        const frontendUrl = process.env.FRONTEND_URL ?? 'https://billr.io';

        const session = await stripe.billingPortal.sessions.create({
          customer: account.stripe_customer_id,
          return_url: request.body?.return_url ?? `${frontendUrl}/billing`,
        });

        return reply.send({ url: session.url });
      } catch (err) {
        request.log.error({ err }, 'Failed to create billing portal session');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
};

export default billingRoutes;
