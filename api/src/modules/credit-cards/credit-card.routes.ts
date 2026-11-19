import type { FastifyPluginAsync } from 'fastify';

import { payCreditCard } from './credit-card.service.js';

import type {
  PayCreditCardBody,
  PayCreditCardParams,
} from './credit-card.types.js';

const uuidSchema = {
  type: 'string',
  pattern:
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
};

export const creditCardRoutes: FastifyPluginAsync = async (app) => {
  app.post<{
    Params: PayCreditCardParams;
    Body: PayCreditCardBody;
  }>(
    '/:cardAccountId/payments',
    {
      preHandler: [app.authenticate],
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['cardAccountId'],
          properties: {
            cardAccountId: uuidSchema,
          },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['sourceAccountId', 'amount'],
          properties: {
            sourceAccountId: uuidSchema,
            amount: {
              type: 'number',
              exclusiveMinimum: 0,
            },
            exchangeRateToBase: {
              type: 'number',
              exclusiveMinimum: 0,
            },
            occurredAt: {
              type: 'string',
              format: 'date-time',
            },
            notes: {
              type: ['string', 'null'],
              maxLength: 5000,
            },
          },
        },
      },
    },
    async (request, reply) => {
      const result = await payCreditCard(request);

      return reply.code(201).send(result);
    },
  );
};
