import Fastify from 'fastify';

// Plugins
import securityHeaders from './plugins/securityHeaders';
import rateLimitPlugin from './plugins/rateLimit';
import auditLogger from './plugins/auditLogger';
import authPlugin from './plugins/auth';

// Routes
import authRoutes from './routes/auth';
import accountsRoutes from './routes/accounts';
import plansRoutes from './routes/plans';
import subscriptionsRoutes from './routes/subscriptions';
import usageRoutes from './routes/usage';
import invoicesRoutes from './routes/invoices';
import webhooksRoutes from './routes/webhooks';
import billingRoutes from './routes/billing';
import auditRoutes from './routes/audit';
import stripeWebhookRoute from './routes/internal/stripeWebhook';

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

export async function buildApp() {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      // Structured JSON logging in production; pretty print in development
      ...(process.env.NODE_ENV !== 'production' && {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true },
        },
      }),
    },
    // Trust Railway/Vercel reverse proxy for correct IP address
    trustProxy: true,
  });

  // ─── Security & Middleware Plugins ────────────────────────────────────────
  // Order matters: security headers first, then rate limits, then audit, then auth.
  await fastify.register(securityHeaders);
  await fastify.register(rateLimitPlugin);
  await fastify.register(auditLogger);
  await fastify.register(authPlugin);

  // ─── Internal Routes (no auth, raw body parsing for Stripe) ───────────────
  // Must be registered BEFORE the /v1 routes that use JSON parsing,
  // because content-type parsers are scoped to the plugin they are registered in.
  await fastify.register(
    async (internalScope) => {
      await internalScope.register(stripeWebhookRoute);
    },
    { prefix: '/internal' },
  );

  // ─── Customer-Facing API Routes (/v1) ────────────────────────────────────
  await fastify.register(
    async (v1) => {
      await v1.register(authRoutes, { prefix: '/auth' });
      await v1.register(accountsRoutes, { prefix: '/accounts' });
      await v1.register(plansRoutes, { prefix: '/plans' });
      await v1.register(subscriptionsRoutes, { prefix: '/subscriptions' });
      await v1.register(usageRoutes, { prefix: '/usage' });
      await v1.register(invoicesRoutes, { prefix: '/invoices' });
      await v1.register(webhooksRoutes, { prefix: '/webhooks' });
      await v1.register(billingRoutes, { prefix: '/billing' });
      await v1.register(auditRoutes, { prefix: '/audit' });
    },
    { prefix: '/v1' },
  );

  // ─── Health Check ─────────────────────────────────────────────────────────
  fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  return fastify;
}

// Only start the server when this file is run directly (not when imported for tests)
if (require.main === module) {
  buildApp()
    .then(async (app) => {
      try {
        await app.listen({ port: PORT, host: HOST });
        console.log(`Billr API listening on ${HOST}:${PORT}`);
      } catch (err) {
        app.log.error(err);
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('Failed to build app:', err);
      process.exit(1);
    });
}
