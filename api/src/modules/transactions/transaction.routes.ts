import type { FastifyPluginAsync } from 'fastify';

import {
  TRANSACTION_CREATE_SCHEMA,
  TRANSACTION_DETAIL_SCHEMA,
  TRANSACTION_LIST_SCHEMA,
  TRANSACTION_UPDATE_SCHEMA,
  TRANSACTION_VOID_SCHEMA,
} from './transaction.schema.js';

import {
  createTransaction,
  getTransactionById,
  listTransactions,
  updateTransaction,
  voidTransaction,
} from './transaction.service.js';

import type {
  CreateTransactionBody,
  ListTransactionsQuery,
  UpdateTransactionBody,
  VoidTransactionBody,
} from './transaction.types.js';

interface TransactionParams {
  transactionId: string;
}

export const transactionRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: ListTransactionsQuery }>(
    '/',
    {
      preHandler: [app.authenticate],
      schema: TRANSACTION_LIST_SCHEMA,
    },
    async (request) => {
      return listTransactions(request, request.query);
    },
  );

  app.get<{ Params: TransactionParams }>(
    '/:transactionId',
    {
      preHandler: [app.authenticate],
      schema: TRANSACTION_DETAIL_SCHEMA,
    },
    async (request) => {
      const transaction = await getTransactionById(
        request,
        request.params.transactionId,
      );

      return {
        data: transaction,
      };
    },
  );

  app.patch<{
    Params: TransactionParams;
    Body: UpdateTransactionBody;
  }>(
    '/:transactionId',
    {
      preHandler: [app.authenticate],
      schema: TRANSACTION_UPDATE_SCHEMA,
    },
    async (request) => {
      const transaction = await updateTransaction(
        request,
        request.params.transactionId,
        request.body,
      );

      return {
        data: transaction,
      };
    },
  );

  app.post<{
    Params: TransactionParams;
    Body: VoidTransactionBody;
  }>(
    '/:transactionId/void',
    {
      preHandler: [app.authenticate],
      schema: TRANSACTION_VOID_SCHEMA,
    },
    async (request) => {
      const transaction = await voidTransaction(
        request,
        request.params.transactionId,
        request.body,
      );

      return {
        data: transaction,
      };
    },
  );

  app.post<{ Body: CreateTransactionBody }>(
    '/',
    {
      preHandler: [app.authenticate],
      schema: TRANSACTION_CREATE_SCHEMA,
    },
    async (request, reply) => {
      const result = await createTransaction(request, request.body);

      return reply.code(201).send(result);
    },
  );
};
