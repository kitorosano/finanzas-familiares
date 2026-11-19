import type { FastifyPluginAsync } from 'fastify';

import { getHouseholdScope } from '../authorization/household-context.js';

import { listAuditLog } from './audit.service.js';
import { AUDIT_ACTIONS, type AuditQuerystring } from './audit.types.js';

export const auditRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: AuditQuerystring }>(
    '/',
    {
      preHandler: [app.authenticate],
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 100,
              default: 50,
            },
            cursor: {
              type: 'string',
              minLength: 1,
              maxLength: 256,
              pattern: '^[A-Za-z0-9_-]+$',
            },
            action: {
              type: 'string',
              enum: [...AUDIT_ACTIONS],
            },
            entityName: {
              type: 'string',
              minLength: 1,
              maxLength: 100,
              pattern: '^[a-z][a-z0-9_]*$',
            },
          },
        },
      },
    },
    async (request) => {
      const scope = getHouseholdScope(request);

      return listAuditLog(scope, request.query);
    },
  );
};
