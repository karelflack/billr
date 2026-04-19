import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import * as argon2 from 'argon2';
import { prisma } from '../lib/db';

// Fastify type augmentation — adds accountId and apiScope to every request
declare module 'fastify' {
  interface FastifyRequest {
    accountId: string;
    apiScope: 'admin' | 'read_only';
  }
}

// Routes that skip authentication entirely
const PUBLIC_ROUTES = new Set([
  'GET /v1/plans',
  'POST /v1/accounts',
]);

const authPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorateRequest('accountId', '');
  fastify.decorateRequest('apiScope', '' as 'admin' | 'read_only');

  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const routeKey = `${request.method} ${request.routerPath ?? request.url.split('?')[0]}`;

    // Skip auth for public endpoints
    if (PUBLIC_ROUTES.has(routeKey)) {
      return;
    }

    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Missing or invalid Authorization header' });
    }

    const rawKey = authHeader.slice(7).trim();
    if (!rawKey) {
      return reply.status(401).send({ error: 'Missing API key' });
    }

    // The first 8 characters of the raw key form the lookup prefix,
    // allowing O(1) prefix lookup before doing the expensive argon2 hash verify.
    const prefix = rawKey.slice(0, 8);

    let apiKey;
    try {
      // Fetch all non-revoked keys matching the prefix.
      // In practice there will be very few (usually 1) per prefix.
      apiKey = await prisma.apiKey.findFirst({
        where: {
          key_prefix: prefix,
          revoked_at: null,
        },
      });
    } catch (err) {
      request.log.error({ err }, 'auth: database lookup failed');
      return reply.status(500).send({ error: 'Internal server error' });
    }

    if (!apiKey) {
      return reply.status(401).send({ error: 'Invalid API key' });
    }

    // Verify the full key against the stored argon2id hash (LB-005)
    let valid: boolean;
    try {
      valid = await argon2.verify(apiKey.key_hash, rawKey);
    } catch (err) {
      request.log.error({ err }, 'auth: argon2 verify failed');
      return reply.status(500).send({ error: 'Internal server error' });
    }

    if (!valid) {
      return reply.status(401).send({ error: 'Invalid API key' });
    }

    request.accountId = apiKey.account_id;
    request.apiScope = apiKey.scope as 'admin' | 'read_only';
  });
};

export default fp(authPlugin, {
  name: 'auth',
  fastify: '4.x',
});
