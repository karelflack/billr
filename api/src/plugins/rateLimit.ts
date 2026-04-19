import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';
import { redis } from '../lib/redis';

const rateLimitPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(rateLimit, {
    // Default: 1000 requests per minute per API key (or IP if no key yet)
    max: 1000,
    timeWindow: '1 minute',
    redis,
    keyGenerator(request) {
      // Use the authenticated account ID when available; fall back to IP.
      // This prevents a shared IP (NAT) from triggering global rate limits.
      return request.accountId || request.ip;
    },
    errorResponseBuilder(_request, context) {
      return {
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Try again in ${context.ttl}ms.`,
        retryAfter: Math.ceil(context.ttl / 1000),
      };
    },
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
  });

  // Stricter limits for authentication endpoints (LB-003):
  // 10 req/min per IP to prevent brute-force key creation
  fastify.register(
    async (authScope) => {
      await authScope.register(rateLimit, {
        max: 10,
        timeWindow: '1 minute',
        redis,
        keyGenerator(request) {
          return `auth:ip:${request.ip}`;
        },
        errorResponseBuilder(_request, context) {
          return {
            error: 'Too Many Requests',
            message: `Authentication rate limit exceeded. Try again in ${context.ttl}ms.`,
            retryAfter: Math.ceil(context.ttl / 1000),
          };
        },
      });
    },
    { prefix: '/v1/auth' },
  );
};

export default fp(rateLimitPlugin, {
  name: 'rate-limit',
  fastify: '4.x',
});
