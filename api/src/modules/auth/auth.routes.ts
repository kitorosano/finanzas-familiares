import type { FastifyPluginAsync } from 'fastify';

import { AppError } from '../../errors/app-error.js';

import { loginUser, refreshSession, revokeSession } from './auth.service.js';
import {
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_OPTIONS,
} from './auth.constants.js';
import { clearRefreshCookie } from './auth.utils.js';

import type { LoginBody } from './auth.types.js';

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: LoginBody }>(
    '/login',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: 15 * 60 * 1000,
        },
      },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['email', 'password'],
          properties: {
            email: {
              type: 'string',
              minLength: 3,
              maxLength: 254,
              pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
            },
            password: {
              type: 'string',
              minLength: 1,
              maxLength: 128,
            },
            householdId: {
              type: 'string',
              pattern:
                '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
            },
          },
        },
      },
    },
    async (request, reply) => {
      const result = await loginUser(
        app,
        request.body.email,
        request.body.password,
        request.body.householdId,
        {
          ipAddress: request.ip || null,
          userAgent: request.headers['user-agent']?.slice(0, 512) ?? null,
        },
      );

      reply.setCookie(
        REFRESH_COOKIE_NAME,
        result.refreshToken,
        REFRESH_COOKIE_OPTIONS,
      );

      return reply.code(200).send(result.authResponse);
    },
  );

  app.post(
    '/refresh',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: 60 * 1000,
        },
      },
    },
    async (request, reply) => {
      const refreshToken = request.cookies[REFRESH_COOKIE_NAME];

      if (!refreshToken) {
        clearRefreshCookie(reply);

        throw new AppError(
          401,
          'REFRESH_TOKEN_MISSING',
          'No existe una sesión para renovar',
        );
      }

      try {
        const result = await refreshSession(app, refreshToken);

        reply.setCookie(
          REFRESH_COOKIE_NAME,
          result.refreshToken,
          REFRESH_COOKIE_OPTIONS,
        );

        return reply.code(200).send(result.authResponse);
      } catch (error) {
        clearRefreshCookie(reply);
        throw error;
      }
    },
  );

  app.get(
    '/me',
    {
      preHandler: [app.authenticate],
    },
    async (request) => {
      if (!request.auth) {
        throw new AppError(
          401,
          'UNAUTHORIZED',
          'Se requiere una sesión autenticada',
        );
      }

      return {
        user: request.auth.user,
        household: request.auth.household,
        sessionId: request.auth.sessionId,
      };
    },
  );

  app.post(
    '/logout',
    {
      preHandler: [app.authenticate],
    },
    async (request, reply) => {
      if (!request.auth) {
        throw new AppError(
          401,
          'UNAUTHORIZED',
          'Se requiere una sesión autenticada',
        );
      }

      await revokeSession(request.auth.sessionId, request.auth.user.id);

      clearRefreshCookie(reply);

      return reply.code(200).send({
        message: 'Sesión cerrada correctamente',
      });
    },
  );
};
