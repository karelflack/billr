import { FastifyPluginAsync } from 'fastify';
import { ActorType, InvoiceStatus } from '@prisma/client';
import { prisma } from '../lib/db';
import { dispatchEvent } from '../services/webhookDispatcher';

const invoicesRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /v1/invoices
   * Lists invoices for the authenticated account with optional filters.
   */
  fastify.get<{
    Querystring: {
      status?: InvoiceStatus;
      start?: string;
      end?: string;
      limit?: string;
      after?: string;
    };
  }>(
    '/',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['draft', 'open', 'paid', 'void', 'uncollectible'] },
            start: { type: 'string', format: 'date-time' },
            end: { type: 'string', format: 'date-time' },
            limit: { type: 'string' },
            after: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const limit = Math.min(parseInt(request.query.limit ?? '20', 10), 100);

        const invoices = await prisma.invoice.findMany({
          where: {
            account_id: request.accountId,
            ...(request.query.status && { status: request.query.status }),
            ...(request.query.start || request.query.end
              ? {
                  created_at: {
                    ...(request.query.start && { gte: new Date(request.query.start) }),
                    ...(request.query.end && { lte: new Date(request.query.end) }),
                  },
                }
              : {}),
            ...(request.query.after && { id: { gt: request.query.after } }),
          },
          orderBy: { created_at: 'desc' },
          take: limit,
        });

        return reply.send({ data: invoices });
      } catch (err) {
        request.log.error({ err }, 'Failed to list invoices');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * GET /v1/invoices/:invoiceId
   * Returns an invoice with its line items.
   */
  fastify.get<{ Params: { invoiceId: string } }>(
    '/:invoiceId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['invoiceId'],
          properties: { invoiceId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      try {
        const invoice = await prisma.invoice.findFirst({
          where: { id: request.params.invoiceId, account_id: request.accountId },
          include: { lineItems: { orderBy: { created_at: 'asc' } } },
        });
        if (!invoice) return reply.status(404).send({ error: 'Invoice not found' });
        return reply.send(invoice);
      } catch (err) {
        request.log.error({ err }, 'Failed to fetch invoice');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * GET /v1/invoices/:invoiceId/pdf
   * 302 redirects to the Stripe-hosted PDF URL, or 404 if none exists.
   */
  fastify.get<{ Params: { invoiceId: string } }>(
    '/:invoiceId/pdf',
    {
      schema: {
        params: {
          type: 'object',
          required: ['invoiceId'],
          properties: { invoiceId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      try {
        const invoice = await prisma.invoice.findFirst({
          where: { id: request.params.invoiceId, account_id: request.accountId },
          select: { pdf_url: true },
        });
        if (!invoice) return reply.status(404).send({ error: 'Invoice not found' });
        if (!invoice.pdf_url) return reply.status(404).send({ error: 'PDF not available for this invoice' });

        return reply.redirect(302, invoice.pdf_url);
      } catch (err) {
        request.log.error({ err }, 'Failed to redirect to invoice PDF');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * POST /v1/invoices/:invoiceId/void
   * Voids an invoice. Admin scope required.
   */
  fastify.post<{ Params: { invoiceId: string } }>(
    '/:invoiceId/void',
    {
      schema: {
        params: {
          type: 'object',
          required: ['invoiceId'],
          properties: { invoiceId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      if (request.apiScope !== 'admin') {
        return reply.status(403).send({ error: 'Admin scope required' });
      }

      try {
        const invoice = await prisma.invoice.findFirst({
          where: { id: request.params.invoiceId, account_id: request.accountId },
        });

        if (!invoice) return reply.status(404).send({ error: 'Invoice not found' });
        if (invoice.status === 'void') return reply.status(409).send({ error: 'Invoice already voided' });
        if (invoice.status === 'paid') return reply.status(409).send({ error: 'Cannot void a paid invoice' });

        const updated = await prisma.invoice.update({
          where: { id: invoice.id },
          data: { status: 'void' },
        });

        await fastify.audit({
          accountId: request.accountId,
          actorType: ActorType.api_key,
          action: 'invoice.voided',
          resourceType: 'invoice',
          resourceId: invoice.id,
          request,
          beforeState: { status: invoice.status },
          afterState: { status: 'void' },
        });

        await dispatchEvent(request.accountId, 'invoice.voided', { invoice: updated });

        return reply.send(updated);
      } catch (err) {
        request.log.error({ err }, 'Failed to void invoice');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
};

export default invoicesRoutes;
