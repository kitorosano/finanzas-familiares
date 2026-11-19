import type { FastifyPluginAsync } from 'fastify';

import { getHouseholdScope } from '../authorization/household-context.js';

import { AUDIT_LIST_SCHEMA } from './audit.schema.js';
import { listAuditLog } from './audit.service.js';
import type { AuditQuerystring } from './audit.types.js';

export const auditRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: AuditQuerystring }>(
    '/',
    {
      preHandler: [app.authenticate],
      schema: AUDIT_LIST_SCHEMA,
    },
    async (request) => {
      const scope = getHouseholdScope(request);

      return listAuditLog(scope, request.query);
    },
  );
};
