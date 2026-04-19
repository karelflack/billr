import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/db';

const auditRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /v1/audit
   * Returns audit log entries. Admin scope required (LB-010).
   * Supports cursor-based pagination and filtering by account, date range, and action.
   */
  fastify.get<{
    Querystring: {
      account_id?: string;
      start?: string;
      end?: string;
      action?: string;
      resource_type?: string;
      limit?: string;
      after?: string; // BigInt ID cursor
    };
  }>(
    '/',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            account_id: { type: 'string', format: 'uuid' },
            start: { type: 'string', format: 'date-time' },
            end: { type: 'string', format: 'date-time' },
            action: { type: 'string' },
            resource_type: { type: 'string' },
            limit: { type: 'string' },
            after: { type: 'string' }, // Stringified BigInt
          },
        },
      },
    },
    async (request, reply) => {
      if (request.apiScope !== 'admin') {
        return reply.status(403).send({ error: 'Admin scope required' });
      }

      try {
        const limit = Math.min(parseInt(request.query.limit ?? '50', 10), 100);

        // Admin can query their own account or any account_id they specify.
        // Non-admins can only see their own account (enforced by scope check above).
        const targetAccountId = request.query.account_id ?? request.accountId;

        const entries = await prisma.auditLog.findMany({
          where: {
            account_id: targetAccountId,
            ...(request.query.start || request.query.end
              ? {
                  created_at: {
                    ...(request.query.start && { gte: new Date(request.query.start) }),
                    ...(request.query.end && { lte: new Date(request.query.end) }),
                  },
                }
              : {}),
            ...(request.query.action && { action: { contains: request.query.action } }),
            ...(request.query.resource_type && { resource_type: request.query.resource_type }),
            ...(request.query.after && { id: { gt: BigInt(request.query.after) } }),
          },
          orderBy: { id: 'desc' },
          take: limit,
        });

        // BigInt requires explicit serialization — JSON.stringify doesn't handle it natively
        return reply.send({
          data: entries.map((e) => ({
            ...e,
            id: e.id.toString(),
          })),
        });
      } catch (err) {
        request.log.error({ err }, 'Failed to list audit logs');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
};

export default auditRoutes;
