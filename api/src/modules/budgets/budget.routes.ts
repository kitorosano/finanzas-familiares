import type { FastifyPluginAsync } from 'fastify';

import { getHouseholdScope } from '../authorization/household-context.js';

import {
  BUDGET_CREATE_SCHEMA,
  BUDGET_DETAIL_SCHEMA,
  BUDGET_LIST_SCHEMA,
  BUDGET_UPDATE_SCHEMA,
} from './budget.schema.js';

import {
  createBudget,
  getBudgetById,
  listBudgets,
  updateBudget,
} from './budget.service.js';

import type {
  BudgetParams,
  CreateBudgetBody,
  ListBudgetsQuery,
  UpdateBudgetBody,
} from './budget.types.js';

export const budgetRoutes: FastifyPluginAsync = async (app) => {
  // =======================================================
  // GET /budgets
  // Listar presupuestos del hogar con ejecución
  // =======================================================

  app.get<{ Querystring: ListBudgetsQuery }>(
    '/',
    {
      preHandler: [app.authenticate],
      schema: BUDGET_LIST_SCHEMA,
    },
    async (request) => {
      const scope = getHouseholdScope(request);

      return listBudgets(scope, request.query);
    },
  );

  // =======================================================
  // GET /budgets/:budgetId
  // Consultar detalle de un presupuesto
  // =======================================================

  app.get<{ Params: BudgetParams }>(
    '/:budgetId',
    {
      preHandler: [app.authenticate],
      schema: BUDGET_DETAIL_SCHEMA,
    },
    async (request) => {
      const scope = getHouseholdScope(request);

      return {
        data: await getBudgetById(scope, request.params.budgetId),
      };
    },
  );

  // =======================================================
  // POST /budgets
  // Crear un presupuesto
  // =======================================================

  app.post<{ Body: CreateBudgetBody }>(
    '/',
    {
      preHandler: [app.authenticate],
      schema: BUDGET_CREATE_SCHEMA,
    },
    async (request, reply) => {
      const scope = getHouseholdScope(request);

      const budget = await createBudget(scope, request.body);

      return reply.code(201).send({
        data: budget,
      });
    },
  );

  // =======================================================
  // PATCH /budgets/:budgetId
  // Actualizar un presupuesto
  // =======================================================

  app.patch<{
    Params: BudgetParams;
    Body: UpdateBudgetBody;
  }>(
    '/:budgetId',
    {
      preHandler: [app.authenticate],
      schema: BUDGET_UPDATE_SCHEMA,
    },
    async (request) => {
      const scope = getHouseholdScope(request);

      return {
        data: await updateBudget(scope, request.params.budgetId, request.body),
      };
    },
  );
};
