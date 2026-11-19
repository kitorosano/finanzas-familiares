import type { FastifyPluginAsync } from 'fastify';

import { getHouseholdScope } from '../authorization/household-context.js';

import {
  getCreditCardById,
  getCreditCardStatementDetail,
  listCreditCards,
  listCreditCardStatements,
  payCreditCard,
} from './credit-card.service.js';

import type {
  ListCreditCardsQuery,
  ListCreditCardStatementsQuery,
  PayCreditCardBody,
  PayCreditCardParams,
} from './credit-card.types.js';

interface CreditCardParams {
  cardAccountId: string;
}

interface CreditCardStatementParams extends CreditCardParams {
  statementId: string;
}

const uuidSchema = {
  type: 'string',
  pattern:
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
};

const cardParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['cardAccountId'],
  properties: {
    cardAccountId: uuidSchema,
  },
};

export const creditCardRoutes: FastifyPluginAsync = async (app) => {
  // =======================================================
  // GET /credit-cards
  // Listar tarjetas del hogar
  // =======================================================

  app.get<{ Querystring: ListCreditCardsQuery }>(
    '/',
    {
      preHandler: [app.authenticate],
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            currencyCode: {
              type: 'string',
              enum: ['UYU', 'USD', 'ARS', 'BRL'],
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
        data: await listCreditCards(scope, request.query),
      };
    },
  );

  // =======================================================
  // GET /credit-cards/:cardAccountId/statements
  // Listar estados de cuenta
  // =======================================================

  app.get<{
    Params: CreditCardParams;
    Querystring: ListCreditCardStatementsQuery;
  }>(
    '/:cardAccountId/statements',
    {
      preHandler: [app.authenticate],
      schema: {
        params: cardParamsSchema,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: {
              type: 'string',
              enum: ['pending', 'partially_paid', 'paid'],
            },
            dueFrom: {
              type: 'string',
              format: 'date',
            },
            dueTo: {
              type: 'string',
              format: 'date',
            },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 100,
              default: 50,
            },
            offset: {
              type: 'integer',
              minimum: 0,
              maximum: 100000,
              default: 0,
            },
          },
        },
      },
    },
    async (request) => {
      const scope = getHouseholdScope(request);

      return listCreditCardStatements(
        scope,
        request.params.cardAccountId,
        request.query,
      );
    },
  );

  // =======================================================
  // GET /credit-cards/:cardAccountId/statements/:statementId
  // Detalle del estado, cuotas y pagos
  // =======================================================

  app.get<{ Params: CreditCardStatementParams }>(
    '/:cardAccountId/statements/:statementId',
    {
      preHandler: [app.authenticate],
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['cardAccountId', 'statementId'],
          properties: {
            cardAccountId: uuidSchema,
            statementId: uuidSchema,
          },
        },
      },
    },
    async (request) => {
      const scope = getHouseholdScope(request);

      return getCreditCardStatementDetail(
        scope,
        request.params.cardAccountId,
        request.params.statementId,
      );
    },
  );

  // =======================================================
  // GET /credit-cards/:cardAccountId
  // Consultar detalle de tarjeta
  // =======================================================

  app.get<{ Params: CreditCardParams }>(
    '/:cardAccountId',
    {
      preHandler: [app.authenticate],
      schema: {
        params: cardParamsSchema,
      },
    },
    async (request) => {
      const scope = getHouseholdScope(request);

      return {
        data: await getCreditCardById(scope, request.params.cardAccountId),
      };
    },
  );

  // =======================================================
  // POST /credit-cards/:cardAccountId/payments
  // Registrar pago o anticipo
  // =======================================================

  app.post<{
    Params: PayCreditCardParams;
    Body: PayCreditCardBody;
  }>(
    '/:cardAccountId/payments',
    {
      preHandler: [app.authenticate],
      schema: {
        params: cardParamsSchema,
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
