import type { FastifyPluginAsync } from 'fastify';

import { getHouseholdScope } from '../authorization/household-context.js';

import {
  CREDIT_CARD_DETAIL_SCHEMA,
  CREDIT_CARD_LIST_SCHEMA,
  CREDIT_CARD_PAYMENT_SCHEMA,
  CREDIT_CARD_STATEMENT_DETAIL_SCHEMA,
  CREDIT_CARD_STATEMENTS_SCHEMA,
} from './credit-card.schema.js';
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

export const creditCardRoutes: FastifyPluginAsync = async (app) => {
  // =======================================================
  // GET /credit-cards
  // Listar tarjetas del hogar
  // =======================================================

  app.get<{ Querystring: ListCreditCardsQuery }>(
    '/',
    {
      preHandler: [app.authenticate],
      schema: CREDIT_CARD_LIST_SCHEMA,
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
      schema: CREDIT_CARD_STATEMENTS_SCHEMA,
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
      schema: CREDIT_CARD_STATEMENT_DETAIL_SCHEMA,
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
      schema: CREDIT_CARD_DETAIL_SCHEMA,
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
      schema: CREDIT_CARD_PAYMENT_SCHEMA,
    },
    async (request, reply) => {
      const result = await payCreditCard(request);

      return reply.code(201).send(result);
    },
  );
};
