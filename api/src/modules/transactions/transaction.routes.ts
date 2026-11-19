import type { FastifyPluginAsync } from 'fastify';

import { createTransaction } from './transaction.service.js';

import type { CreateTransactionBody } from './transaction.types.js';

const uuidSchema = {
  type: 'string',
  pattern:
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
};

const commonProperties = {
  accountId: uuidSchema,
  amount: {
    type: 'number',
    exclusiveMinimum: 0,
  },
  occurredAt: {
    type: 'string',
    format: 'date-time',
  },
  description: {
    type: ['string', 'null'],
    maxLength: 1000,
  },
  notes: {
    type: ['string', 'null'],
    maxLength: 5000,
  },
  status: {
    type: 'string',
    enum: ['pending', 'posted'],
  },
  exchangeRateToBase: {
    type: 'number',
    exclusiveMinimum: 0,
  },
};

const createTransactionSchema = {
  body: {
    oneOf: [
      {
        type: 'object',
        additionalProperties: false,
        required: ['transactionType', 'accountId', 'amount', 'categoryId'],
        properties: {
          ...commonProperties,
          transactionType: {
            type: 'string',
            enum: ['income', 'expense'],
          },
          categoryId: uuidSchema,
          installmentsCount: {
            type: 'integer',
            minimum: 1,
            maximum: 240,
          },
        },
      },
      {
        type: 'object',
        additionalProperties: false,
        required: [
          'transactionType',
          'accountId',
          'amount',
          'transferAccountId',
          'transferAmount',
        ],
        properties: {
          ...commonProperties,
          transactionType: {
            type: 'string',
            const: 'transfer',
          },
          transferAccountId: uuidSchema,
          transferAmount: {
            type: 'number',
            exclusiveMinimum: 0,
          },
          transferExchangeRateToBase: {
            type: 'number',
            exclusiveMinimum: 0,
          },
        },
      },
    ],
  },
};

export const transactionRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: CreateTransactionBody }>(
    '/',
    {
      preHandler: [app.authenticate],
      schema: createTransactionSchema,
    },
    async (request, reply) => {
      const result = await createTransaction(request, request.body);

      return reply.code(201).send(result);
    },
  );
};
