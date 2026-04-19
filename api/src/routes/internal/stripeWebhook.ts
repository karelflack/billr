import { FastifyPluginAsync } from 'fastify';
import Stripe from 'stripe';
import { ActorType } from '@prisma/client';
import { prisma } from '../../lib/db';
import { stripe } from '../../lib/stripe';
import { dispatchEvent } from '../../services/webhookDispatcher';
import { toDecimal, formatAmount } from '../../lib/money';

if (!process.env.STRIPE_WEBHOOK_SECRET) {
  throw new Error('STRIPE_WEBHOOK_SECRET environment variable is required');
}

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

/**
 * POST /internal/stripe/webhook
 *
 * LB-001: MANDATORY raw body parsing for Stripe signature verification.
 * The Stripe SDK verifies the Stripe-Signature header against a SHA-256 HMAC
 * of the raw request bytes. If we parse the body as JSON first, the byte
 * comparison fails even if the payload is semantically identical.
 */
const stripeWebhookRoute: FastifyPluginAsync = async (fastify) => {
  // Register a custom content-type parser that captures the raw Buffer.
  // This MUST be scoped to this plugin only — not set globally — to avoid
  // breaking JSON parsing on other routes.
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req, body, done) => {
      done(null, body);
    },
  );

  fastify.post('/stripe/webhook', async (request, reply) => {
    const sig = request.headers['stripe-signature'];
    if (!sig || typeof sig !== 'string') {
      return reply.status(400).send({ error: 'Missing Stripe-Signature header' });
    }

    const rawBody = request.body as Buffer;

    // Verify signature — returns 400 on failure (LB-001)
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      request.log.warn({ err }, 'Stripe webhook signature verification failed');
      return reply.status(400).send({ error: 'Invalid Stripe signature' });
    }

    // Idempotency check — skip events already processed (prevents double-billing)
    const alreadyProcessed = await prisma.processedStripeEvent.findUnique({
      where: { stripe_event_id: event.id },
    });
    if (alreadyProcessed) {
      request.log.info({ eventId: event.id }, 'Stripe event already processed, skipping');
      return reply.status(200).send({ received: true });
    }

    // Mark as processed BEFORE handling — if the handler crashes we at least
    // won't double-process. The upsert handles rare concurrent delivery.
    await prisma.processedStripeEvent.upsert({
      where: { stripe_event_id: event.id },
      create: { stripe_event_id: event.id },
      update: {},
    });

    try {
      await handleEvent(event, request.log);
    } catch (err) {
      // Log but still return 200 — Stripe will retry if we 5xx, which could
      // cause duplicate processing after the idempotency record is already written.
      request.log.error({ err, eventId: event.id, eventType: event.type }, 'Error handling Stripe event');
    }

    return reply.status(200).send({ received: true });
  });
};

interface SimpleLogger {
  error(obj: Record<string, unknown>, msg: string): void;
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

async function handleEvent(event: Stripe.Event, log: SimpleLogger): Promise<void> {
  switch (event.type) {
    case 'customer.subscription.created': {
      const stripeSub = event.data.object as Stripe.Subscription;
      await syncSubscription(stripeSub);
      break;
    }

    case 'customer.subscription.updated': {
      const stripeSub = event.data.object as Stripe.Subscription;
      await syncSubscription(stripeSub);
      break;
    }

    case 'customer.subscription.deleted': {
      const stripeSub = event.data.object as Stripe.Subscription;
      const sub = await prisma.subscription.findFirst({
        where: { stripe_subscription_id: stripeSub.id },
        include: { account: true },
      });
      if (!sub) {
        log.info({ stripeSubId: stripeSub.id }, 'No local subscription found for deleted Stripe sub');
        break;
      }

      await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: 'canceled', ended_at: new Date() },
      });

      // Audit log with system actor
      await prisma.auditLog.create({
        data: {
          account_id: sub.account_id,
          actor_type: ActorType.stripe,
          actor_id: event.id,
          action: 'subscription.ended',
          resource_type: 'subscription',
          resource_id: sub.id,
          after_state: { status: 'canceled', stripe_event_id: event.id },
        },
      });

      await dispatchEvent(sub.account_id, 'subscription.ended', { subscription_id: sub.id });
      break;
    }

    case 'invoice.created': {
      const stripeInvoice = event.data.object as Stripe.Invoice;
      await upsertInvoice(stripeInvoice, 'draft');
      break;
    }

    case 'invoice.finalized': {
      const stripeInvoice = event.data.object as Stripe.Invoice;
      const updated = await upsertInvoice(stripeInvoice, 'open');
      if (updated) {
        await dispatchEvent(updated.account_id, 'invoice.created', { invoice_id: updated.id });
      }
      break;
    }

    case 'invoice.payment_succeeded': {
      const stripeInvoice = event.data.object as Stripe.Invoice;
      const invoice = await prisma.invoice.findFirst({
        where: { stripe_invoice_id: stripeInvoice.id },
      });

      if (invoice) {
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { status: 'paid', paid_at: new Date() },
        });

        // Activate subscription if it was past_due
        if (stripeInvoice.subscription && typeof stripeInvoice.subscription === 'string') {
          await prisma.subscription.updateMany({
            where: {
              stripe_subscription_id: stripeInvoice.subscription,
              status: 'past_due',
            },
            data: { status: 'active' },
          });
        }

        await prisma.auditLog.create({
          data: {
            account_id: invoice.account_id,
            actor_type: ActorType.stripe,
            actor_id: event.id,
            action: 'invoice.paid',
            resource_type: 'invoice',
            resource_id: invoice.id,
            after_state: { status: 'paid', stripe_event_id: event.id },
          },
        });

        await dispatchEvent(invoice.account_id, 'invoice.paid', { invoice_id: invoice.id });
      } else {
        // Invoice may not yet exist — create it
        const created = await upsertInvoice(stripeInvoice, 'paid');
        if (created) {
          await prisma.invoice.update({
            where: { id: created.id },
            data: { paid_at: new Date() },
          });
          await dispatchEvent(created.account_id, 'invoice.paid', { invoice_id: created.id });
        }
      }
      break;
    }

    case 'invoice.payment_failed': {
      const stripeInvoice = event.data.object as Stripe.Invoice;

      // Mark subscription as past_due
      if (stripeInvoice.subscription && typeof stripeInvoice.subscription === 'string') {
        const sub = await prisma.subscription.findFirst({
          where: { stripe_subscription_id: stripeInvoice.subscription },
        });
        if (sub) {
          await prisma.subscription.update({
            where: { id: sub.id },
            data: { status: 'past_due' },
          });
          await dispatchEvent(sub.account_id, 'invoice.payment_failed', {
            invoice_id: stripeInvoice.id,
            subscription_id: sub.id,
          });
        }
      }
      break;
    }

    case 'customer.deleted': {
      const customer = event.data.object as Stripe.Customer;
      // Null out the stripe_customer_id — the account still exists but payment is unlinked
      await prisma.account.updateMany({
        where: { stripe_customer_id: customer.id },
        data: { stripe_customer_id: null },
      });
      break;
    }

    default:
      log.info({ eventType: event.type }, 'Unhandled Stripe event type — ignoring');
  }
}

/**
 * Finds the Billr account_id from a Stripe invoice's customer field.
 * Returns null if the customer cannot be matched.
 */
async function resolveAccountFromStripeCustomer(customerId: string | Stripe.Customer | Stripe.DeletedCustomer | null): Promise<string | null> {
  if (!customerId || typeof customerId !== 'string') return null;
  const account = await prisma.account.findFirst({
    where: { stripe_customer_id: customerId },
    select: { id: true },
  });
  return account?.id ?? null;
}

/**
 * Finds the Billr subscription_id from a Stripe subscription ID.
 */
async function resolveSubscriptionId(stripeSubId: string | Stripe.Subscription | null): Promise<string | null> {
  if (!stripeSubId || typeof stripeSubId !== 'string') return null;
  const sub = await prisma.subscription.findFirst({
    where: { stripe_subscription_id: stripeSubId },
    select: { id: true },
  });
  return sub?.id ?? null;
}

/**
 * Upserts a Billr invoice record from a Stripe invoice object.
 * Returns the upserted invoice or null if account can't be resolved.
 */
async function upsertInvoice(stripeInvoice: Stripe.Invoice, status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible') {
  const accountId = await resolveAccountFromStripeCustomer(stripeInvoice.customer);
  if (!accountId) return null;

  const subscriptionId = await resolveSubscriptionId(
    typeof stripeInvoice.subscription === 'string' ? stripeInvoice.subscription : null,
  );

  // Convert Stripe amounts from integer cents to Decimal, then to NUMERIC(12,2) string.
  // Using toDecimal() prevents any float precision issues during the cents→dollars conversion.
  const subtotal = formatAmount(toDecimal(stripeInvoice.subtotal ?? 0).div(100));
  const tax = formatAmount(toDecimal(stripeInvoice.tax ?? 0).div(100));
  const total = formatAmount(toDecimal(stripeInvoice.total ?? 0).div(100));

  const invoice = await prisma.invoice.upsert({
    where: { stripe_invoice_id: stripeInvoice.id },
    create: {
      account_id: accountId,
      subscription_id: subscriptionId,
      stripe_invoice_id: stripeInvoice.id,
      status,
      currency: stripeInvoice.currency.toUpperCase(),
      subtotal,
      tax,
      total,
      due_date: stripeInvoice.due_date ? new Date(stripeInvoice.due_date * 1000) : null,
      period_start: stripeInvoice.period_start ? new Date(stripeInvoice.period_start * 1000) : null,
      period_end: stripeInvoice.period_end ? new Date(stripeInvoice.period_end * 1000) : null,
      pdf_url: stripeInvoice.invoice_pdf ?? null,
    },
    update: {
      status,
      subtotal,
      tax,
      total,
      paid_at: status === 'paid' ? new Date() : undefined,
      pdf_url: stripeInvoice.invoice_pdf ?? undefined,
    },
  });

  return invoice;
}

/**
 * Syncs a local subscription record from a Stripe subscription object.
 * Used for customer.subscription.created and customer.subscription.updated events.
 */
async function syncSubscription(stripeSub: Stripe.Subscription): Promise<void> {
  const sub = await prisma.subscription.findFirst({
    where: { stripe_subscription_id: stripeSub.id },
  });
  if (!sub) return;

  // Map Stripe status to Billr status
  const statusMap: Record<string, string> = {
    trialing: 'trialing',
    active: 'active',
    past_due: 'past_due',
    canceled: 'canceled',
    unpaid: 'unpaid',
    paused: 'paused',
    incomplete: 'past_due',
    incomplete_expired: 'canceled',
  };

  const newStatus = (statusMap[stripeSub.status] ?? 'active') as 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'paused';

  await prisma.subscription.update({
    where: { id: sub.id },
    data: {
      status: newStatus,
      current_period_start: new Date(stripeSub.current_period_start * 1000),
      current_period_end: new Date(stripeSub.current_period_end * 1000),
      cancel_at_period_end: stripeSub.cancel_at_period_end,
      trial_end: stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : null,
      ended_at: stripeSub.ended_at ? new Date(stripeSub.ended_at * 1000) : null,
    },
  });
}

export default stripeWebhookRoute;
