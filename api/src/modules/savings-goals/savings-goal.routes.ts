import type { FastifyPluginAsync } from 'fastify';

import { getHouseholdScope } from '../authorization/household-context.js';

import {
  SAVINGS_GOAL_CONTRIBUTIONS_LIST_SCHEMA,
  SAVINGS_GOAL_CONTRIBUTION_CREATE_SCHEMA,
  SAVINGS_GOAL_CONTRIBUTION_VOID_SCHEMA,
  SAVINGS_GOAL_CREATE_SCHEMA,
  SAVINGS_GOAL_DETAIL_SCHEMA,
  SAVINGS_GOAL_LIST_SCHEMA,
  SAVINGS_GOAL_UPDATE_SCHEMA,
} from './savings-goal.schema.js';

import {
  createSavingsGoal,
  createSavingsGoalContribution,
  getSavingsGoalById,
  listSavingsGoalContributions,
  listSavingsGoals,
  updateSavingsGoal,
  voidSavingsGoalContribution,
} from './savings-goal.service.js';

import type {
  CreateSavingsGoalBody,
  CreateSavingsGoalContributionBody,
  ListSavingsGoalContributionsQuery,
  ListSavingsGoalsQuery,
  SavingsGoalContributionParams,
  SavingsGoalParams,
  UpdateSavingsGoalBody,
  VoidSavingsGoalContributionBody,
} from './savings-goal.types.js';

export const savingsGoalRoutes: FastifyPluginAsync = async (app) => {
  // =======================================================
  // GET /savings-goals
  // Listar objetivos y progreso
  // =======================================================

  app.get<{ Querystring: ListSavingsGoalsQuery }>(
    '/',
    {
      preHandler: [app.authenticate],
      schema: SAVINGS_GOAL_LIST_SCHEMA,
    },
    async (request) => {
      const scope = getHouseholdScope(request);

      return listSavingsGoals(scope, request.query);
    },
  );

  // =======================================================
  // POST /savings-goals
  // Crear objetivo
  // =======================================================

  app.post<{ Body: CreateSavingsGoalBody }>(
    '/',
    {
      preHandler: [app.authenticate],
      schema: SAVINGS_GOAL_CREATE_SCHEMA,
    },
    async (request, reply) => {
      const scope = getHouseholdScope(request);

      const goal = await createSavingsGoal(scope, request.body);

      return reply.code(201).send({
        data: goal,
      });
    },
  );

  // =======================================================
  // GET /savings-goals/:goalId/contributions
  // Listar aportes de un objetivo
  // =======================================================

  app.get<{
    Params: SavingsGoalParams;
    Querystring: ListSavingsGoalContributionsQuery;
  }>(
    '/:goalId/contributions',
    {
      preHandler: [app.authenticate],
      schema: SAVINGS_GOAL_CONTRIBUTIONS_LIST_SCHEMA,
    },
    async (request) => {
      const scope = getHouseholdScope(request);

      return listSavingsGoalContributions(
        scope,
        request.params.goalId,
        request.query,
      );
    },
  );

  // =======================================================
  // POST /savings-goals/:goalId/contributions
  // Crear aporte y transferencia atómicamente
  // =======================================================

  app.post<{
    Params: SavingsGoalParams;
    Body: CreateSavingsGoalContributionBody;
  }>(
    '/:goalId/contributions',
    {
      preHandler: [app.authenticate],
      schema: SAVINGS_GOAL_CONTRIBUTION_CREATE_SCHEMA,
    },
    async (request, reply) => {
      const scope = getHouseholdScope(request);

      const result = await createSavingsGoalContribution(
        scope,
        request.params.goalId,
        request.body,
      );

      return reply.code(201).send(result);
    },
  );

  // =======================================================
  // POST /savings-goals/:goalId/contributions/:contributionId/void
  // Anular aporte y transferencia atómicamente
  // =======================================================

  app.post<{
    Params: SavingsGoalContributionParams;
    Body: VoidSavingsGoalContributionBody;
  }>(
    '/:goalId/contributions/:contributionId/void',
    {
      preHandler: [app.authenticate],
      schema: SAVINGS_GOAL_CONTRIBUTION_VOID_SCHEMA,
    },
    async (request) => {
      const scope = getHouseholdScope(request);

      return voidSavingsGoalContribution(
        scope,
        request.params.goalId,
        request.params.contributionId,
        request.body,
      );
    },
  );

  // =======================================================
  // GET /savings-goals/:goalId
  // Consultar detalle de un objetivo
  // =======================================================

  app.get<{ Params: SavingsGoalParams }>(
    '/:goalId',
    {
      preHandler: [app.authenticate],
      schema: SAVINGS_GOAL_DETAIL_SCHEMA,
    },
    async (request) => {
      const scope = getHouseholdScope(request);

      return {
        data: await getSavingsGoalById(scope, request.params.goalId),
      };
    },
  );

  // =======================================================
  // PATCH /savings-goals/:goalId
  // Actualizar objetivo
  // =======================================================

  app.patch<{
    Params: SavingsGoalParams;
    Body: UpdateSavingsGoalBody;
  }>(
    '/:goalId',
    {
      preHandler: [app.authenticate],
      schema: SAVINGS_GOAL_UPDATE_SCHEMA,
    },
    async (request) => {
      const scope = getHouseholdScope(request);

      return {
        data: await updateSavingsGoal(
          scope,
          request.params.goalId,
          request.body,
        ),
      };
    },
  );
};
