import type { FastifyPluginAsync } from 'fastify';

import { getHouseholdScope } from '../authorization/household-context.js';

import { getAccountById, listAccounts } from './account.service.js';

import {
  ACCOUNT_TYPES,
  CURRENCY_CODES,
  type ListAccountsQuery,
} from './account.types.js';

interface AccountParams {
  accountId: string;
}

const uuidSchema = {
  type: 'string',
  pattern:
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
};

export const accountRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: ListAccountsQuery }>(
    '/',
    {
      preHandler: [app.authenticate],
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            accountType: {
              type: 'string',
              enum: [...ACCOUNT_TYPES],
            },
            currencyCode: {
              type: 'string',
              enum: [...CURRENCY_CODES],
            },
            includeInactive: {
              type: 'boolean',
              default: false,
            },
          },
        },
      },
    },
    async (request) => {
      const scope = getHouseholdScope(request);

      return {
        data: await listAccounts(scope, request.query),
      };
    },
  );

  app.get<{ Params: AccountParams }>(
    '/:accountId',
    {
      preHandler: [app.authenticate],
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['accountId'],
          properties: {
            accountId: uuidSchema,
          },
        },
      },
    },
    async (request) => {
      const scope = getHouseholdScope(request);

      return {
        data: await getAccountById(scope, request.params.accountId),
      };
    },
  );
};
