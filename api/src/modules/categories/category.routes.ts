import type { FastifyPluginAsync } from 'fastify';

import { getHouseholdScope } from '../authorization/household-context.js';

import {
  CATEGORY_CREATE_SCHEMA,
  CATEGORY_DETAIL_SCHEMA,
  CATEGORY_LIST_SCHEMA,
  CATEGORY_UPDATE_SCHEMA,
} from './category.schema.js';

import {
  createCategory,
  getCategoryById,
  listCategories,
  updateCategory,
} from './category.service.js';

import type {
  CategoryParams,
  CreateCategoryBody,
  ListCategoriesQuery,
  UpdateCategoryBody,
} from './category.types.js';

export const categoryRoutes: FastifyPluginAsync = async (app) => {
  // =======================================================
  // GET /categories
  // Listar categorías del hogar y del sistema
  // =======================================================

  app.get<{ Querystring: ListCategoriesQuery }>(
    '/',
    {
      preHandler: [app.authenticate],
      schema: CATEGORY_LIST_SCHEMA,
    },
    async (request) => {
      const scope = getHouseholdScope(request);

      return {
        data: await listCategories(scope, request.query),
      };
    },
  );

  // =======================================================
  // GET /categories/:categoryId
  // Consultar detalle de una categoría
  // =======================================================

  app.get<{ Params: CategoryParams }>(
    '/:categoryId',
    {
      preHandler: [app.authenticate],
      schema: CATEGORY_DETAIL_SCHEMA,
    },
    async (request) => {
      const scope = getHouseholdScope(request);

      return {
        data: await getCategoryById(scope, request.params.categoryId),
      };
    },
  );

  // =======================================================
  // POST /categories
  // Crear una categoría personalizada
  // =======================================================

  app.post<{ Body: CreateCategoryBody }>(
    '/',
    {
      preHandler: [app.authenticate],
      schema: CATEGORY_CREATE_SCHEMA,
    },
    async (request, reply) => {
      const scope = getHouseholdScope(request);

      const category = await createCategory(scope, request.body);

      return reply.code(201).send({
        data: category,
      });
    },
  );

  // =======================================================
  // PATCH /categories/:categoryId
  // Actualizar una categoría personalizada
  // =======================================================

  app.patch<{
    Params: CategoryParams;
    Body: UpdateCategoryBody;
  }>(
    '/:categoryId',
    {
      preHandler: [app.authenticate],
      schema: CATEGORY_UPDATE_SCHEMA,
    },
    async (request) => {
      const scope = getHouseholdScope(request);

      return {
        data: await updateCategory(
          scope,
          request.params.categoryId,
          request.body,
        ),
      };
    },
  );
};
