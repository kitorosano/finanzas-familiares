import type { FastifyPluginAsync } from 'fastify';

import { getHouseholdScope } from '../authorization/household-context.js';

import {
  ACCOUNT_DETAIL_SCHEMA,
  ACCOUNT_LIST_SCHEMA,
} from './account.schema.js';
import { getAccountById, listAccounts } from './account.service.js';

import type { ListAccountsQuery } from './account.types.js';

interface AccountParams {
  accountId: string;
}

export const accountRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: ListAccountsQuery }>(
    '/',
    {
      preHandler: [app.authenticate],
      schema: ACCOUNT_LIST_SCHEMA,
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
      schema: ACCOUNT_DETAIL_SCHEMA,
    },
    async (request) => {
      const scope = getHouseholdScope(request);

      return {
        data: await getAccountById(scope, request.params.accountId),
      };
    },
  );
};
