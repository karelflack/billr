import { FastifyPluginAsync } from 'fastify';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { ActorType } from '@prisma/client';
import { prisma } from '../lib/db';

const authRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /v1/auth/keys
   * Creates a new API key for the authenticated account.
   * The plaintext key is returned ONCE and never stored — only the argon2id hash is persisted.
   */
  fastify.post<{
    Body: { scope?: 'admin' | 'read_only'; description?: string };
  }>(
    '/keys',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            scope: { type: 'string', enum: ['admin', 'read_only'] },
            description: { type: 'string', maxLength: 255 },
          },
        },
      },
    },
    async (request, reply) => {
      const accountId = request.accountId;
      const scope = request.body?.scope ?? 'read_only';
      const description = request.body?.description ?? null;

      // Generate a 32-byte random key with a recognisable prefix.
      // Format: bk_live_<64 hex chars>
      const rawKey = `bk_live_${randomBytes(32).toString('hex')}`;
      // First 8 chars are stored as prefix for O(1) DB lookup during auth.
      const prefix = rawKey.slice(0, 8);

      // Hash with argon2id (LB-005) — this is the value stored in DB.
      // Never store the plaintext rawKey.
      let keyHash: string;
      try {
        keyHash = await argon2.hash(rawKey, { type: argon2.argon2id });
      } catch (err) {
        request.log.error({ err }, 'Failed to hash API key');
        return reply.status(500).send({ error: 'Internal server error' });
      }

      try {
        const apiKey = await prisma.apiKey.create({
          data: {
            account_id: accountId,
            key_hash: keyHash,
            key_prefix: prefix,
            scope,
            description,
          },
        });

        await fastify.audit({
          accountId,
          actorType: ActorType.api_key,
          action: 'api_key.created',
          resourceType: 'api_key',
          resourceId: apiKey.id,
          request,
          afterState: { id: apiKey.id, scope, description },
        });

        return reply.status(201).send({
          id: apiKey.id,
          key: rawKey, // Returned ONCE — never accessible again
          prefix,
          scope: apiKey.scope,
          description: apiKey.description,
          created_at: apiKey.created_at,
        });
      } catch (err) {
        request.log.error({ err }, 'Failed to create API key');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * GET /v1/auth/keys
   * Lists all API keys for the account. key_hash is NEVER returned.
   */
  fastify.get('/keys', async (request, reply) => {
    try {
      const keys = await prisma.apiKey.findMany({
        where: { account_id: request.accountId },
        select: {
          id: true,
          key_prefix: true,
          scope: true,
          description: true,
          revoked_at: true,
          created_at: true,
        },
        orderBy: { created_at: 'desc' },
      });
      return reply.send({ data: keys });
    } catch (err) {
      request.log.error({ err }, 'Failed to list API keys');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * DELETE /v1/auth/keys/:keyId
   * Revokes an API key by setting revoked_at. The key remains in the DB
   * for audit trail purposes but will be rejected on future requests.
   */
  fastify.delete<{ Params: { keyId: string } }>(
    '/keys/:keyId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['keyId'],
          properties: { keyId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      const { keyId } = request.params;

      try {
        const existing = await prisma.apiKey.findFirst({
          where: { id: keyId, account_id: request.accountId },
        });

        if (!existing) {
          return reply.status(404).send({ error: 'API key not found' });
        }

        if (existing.revoked_at) {
          return reply.status(409).send({ error: 'API key already revoked' });
        }

        const updated = await prisma.apiKey.update({
          where: { id: keyId },
          data: { revoked_at: new Date() },
        });

        await fastify.audit({
          accountId: request.accountId,
          actorType: ActorType.api_key,
          action: 'api_key.revoked',
          resourceType: 'api_key',
          resourceId: keyId,
          request,
          beforeState: { revoked_at: null },
          afterState: { revoked_at: updated.revoked_at },
        });

        return reply.status(200).send({ id: keyId, revoked_at: updated.revoked_at });
      } catch (err) {
        request.log.error({ err }, 'Failed to revoke API key');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
};

export default authRoutes;
