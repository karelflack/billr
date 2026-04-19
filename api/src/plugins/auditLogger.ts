import { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { ActorType } from '@prisma/client';
import { prisma } from '../lib/db';

export interface AuditParams {
  accountId: string;
  actorType: ActorType;
  actorId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  request?: FastifyRequest;
}

// Fastify type augmentation — exposes fastify.audit() helper on the instance
declare module 'fastify' {
  interface FastifyInstance {
    audit(params: AuditParams): Promise<void>;
  }
}

const auditLoggerPlugin: FastifyPluginAsync = async (fastify) => {
  // Decorate the fastify instance with an audit() helper that routes can call
  // explicitly for mutation events. This is the preferred approach for precise
  // before/after state capture. The hook below handles implicit logging.
  fastify.decorate('audit', async (params: AuditParams): Promise<void> => {
    try {
      await prisma.auditLog.create({
        data: {
          account_id: params.accountId,
          actor_type: params.actorType,
          actor_id: params.actorId ?? null,
          action: params.action,
          resource_type: params.resourceType,
          resource_id: params.resourceId ?? null,
          before_state: params.beforeState ?? null,
          after_state: params.afterState ?? null,
          ip_address: params.request?.ip ?? null,
          user_agent: params.request?.headers['user-agent'] ?? null,
        },
      });
    } catch (err) {
      // Audit log failures must not block the response. Log the error and
      // continue — the caller's operation has already succeeded.
      fastify.log.error({ err }, 'audit: failed to write audit log entry');
    }
  });

  // Implicit hook: log all state-mutating requests automatically at the route level.
  // Routes that need before/after state should call fastify.audit() explicitly instead.
  fastify.addHook('onResponse', async (request, reply) => {
    const method = request.method;
    // Only log mutations that succeeded
    if (
      method === 'GET' ||
      method === 'HEAD' ||
      method === 'OPTIONS' ||
      reply.statusCode >= 400
    ) {
      return;
    }

    // Skip if accountId was not resolved (e.g., unauthenticated public route)
    if (!request.accountId) {
      return;
    }

    // Derive a human-readable action from method + URL
    const urlPath = request.url.split('?')[0];
    const action = `${method.toLowerCase()}:${urlPath}`;

    try {
      await prisma.auditLog.create({
        data: {
          account_id: request.accountId,
          actor_type: ActorType.api_key,
          actor_id: null,
          action,
          resource_type: deriveResourceType(urlPath),
          resource_id: null,
          before_state: null,
          after_state: null,
          ip_address: request.ip ?? null,
          user_agent: request.headers['user-agent'] ?? null,
        },
      });
    } catch (err) {
      fastify.log.error({ err }, 'audit: implicit hook failed to write entry');
    }
  });
};

/** Derives a resource type string from the URL path segment. */
function deriveResourceType(urlPath: string): string {
  const segments = urlPath.replace(/^\/v1\//, '').split('/');
  return segments[0] ?? 'unknown';
}

export default fp(auditLoggerPlugin, {
  name: 'audit-logger',
  fastify: '4.x',
});
