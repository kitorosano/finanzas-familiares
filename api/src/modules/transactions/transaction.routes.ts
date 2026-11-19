import type { FastifyPluginAsync } from 'fastify';

import { TRANSACTION_CREATE_SCHEMA } from './transaction.schema.js';
import { createTransaction } from './transaction.service.js';

import type { CreateTransactionBody } from './transaction.types.js';

export const transactionRoutes: FastifyPluginAsync = async (app) => {
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
