import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import helmet from '@fastify/helmet';

// LB-009: Security headers on all HTTP responses.
// helmet handles most headers; CSP and Permissions-Policy are set explicitly
// to match the exact values required by the compliance checklist.
const securityHeadersPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(helmet, {
    // Content-Security-Policy: allow Stripe JS/frames for payment forms
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://js.stripe.com'],
        frameSrc: ['https://js.stripe.com'],
        connectSrc: ["'self'", 'https://api.stripe.com'],
      },
    },
    // X-Content-Type-Options: nosniff (prevents MIME sniffing)
    noSniff: true,
    // X-Frame-Options: DENY (prevents clickjacking)
    frameguard: { action: 'deny' },
    // Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    // Referrer-Policy: strict-origin-when-cross-origin
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginEmbedderPolicy: false,
  });

  // Permissions-Policy: payment=() — restricts Payment Request API to Stripe origins
  fastify.addHook('onSend', async (_request, reply) => {
    reply.header('Permissions-Policy', 'payment=()');
    return;
  });
};

export default fp(securityHeadersPlugin, {
  name: 'security-headers',
  fastify: '4.x',
});
