import type { FastifyPluginAsync } from 'fastify';

import { getHouseholdScope } from '../authorization/household-context.js';

import {
  RECURRING_TRANSACTION_CREATE_SCHEMA,
  RECURRING_TRANSACTION_DETAIL_SCHEMA,
  RECURRING_TRANSACTION_LIST_SCHEMA,
  RECURRING_TRANSACTION_UPDATE_SCHEMA,
} from './recurring-transaction.schema.js';

import {
  createRecurringTransaction,
  getRecurringTransactionById,
  listRecurringTransactions,
  updateRecurringTransaction,
} from './recurring-transaction.service.js';

import type {
  CreateRecurringTransactionBody,
  ListRecurringTransactionsQuery,
  RecurringTransactionParams,
  UpdateRecurringTransactionBody,
} from './recurring-transaction.types.js';

export const recurringTransactionRoutes: FastifyPluginAsync = async (app) => {
  // =======================================================
  // GET /recurring-transactions
  // Listar movimientos recurrentes
  // =======================================================

  app.get<{ Querystring: ListRecurringTransactionsQuery }>(
    '/',
    {
      preHandler: [app.authenticate],
      schema: RECURRING_TRANSACTION_LIST_SCHEMA,
    },
    async (request) => {
      const scope = getHouseholdScope(request);

      return listRecurringTransactions(scope, request.query);
    },
  );

  // =======================================================
  // GET /recurring-transactions/:recurringTransactionId
  // Consultar detalle
  // =======================================================

  app.get<{ Params: RecurringTransactionParams }>(
    '/:recurringTransactionId',
    {
      preHandler: [app.authenticate],
      schema: RECURRING_TRANSACTION_DETAIL_SCHEMA,
    },
    async (request) => {
      const scope = getHouseholdScope(request);

      return {
        data: await getRecurringTransactionById(
          scope,
          request.params.recurringTransactionId,
        ),
      };
    },
  );

  // =======================================================
  // POST /recurring-transactions
  // Crear movimiento recurrente
  // =======================================================

  app.post<{ Body: CreateRecurringTransactionBody }>(
    '/',
    {
      preHandler: [app.authenticate],
      schema: RECURRING_TRANSACTION_CREATE_SCHEMA,
    },
    async (request, reply) => {
      const scope = getHouseholdScope(request);

      const recurringTransaction = await createRecurringTransaction(
        scope,
        request.body,
      );

      return reply.code(201).send({
        data: recurringTransaction,
      });
    },
  );

  // =======================================================
  // PATCH /recurring-transactions/:recurringTransactionId
  // Modificar movimiento recurrente
  // =======================================================

  app.patch<{
    Params: RecurringTransactionParams;
    Body: UpdateRecurringTransactionBody;
  }>(
    '/:recurringTransactionId',
    {
      preHandler: [app.authenticate],
      schema: RECURRING_TRANSACTION_UPDATE_SCHEMA,
    },
    async (request) => {
      const scope = getHouseholdScope(request);

      return {
        data: await updateRecurringTransaction(
          scope,
          request.params.recurringTransactionId,
          request.body,
        ),
      };
    },
  );
};
