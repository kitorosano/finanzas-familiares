import Fastify, { type FastifyInstance } from 'fastify';

import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';

import { env } from './config/env.js';
import { db } from './db/pool.js';
import { registerApiErrorHandler } from './errors/error-handler.js';
import { accountRoutes } from './modules/accounts/account.routes.js';
import { auditRoutes } from './modules/audit/audit.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { authenticateRequest } from './modules/auth/authenticate.js';
import { categoryRoutes } from './modules/categories/category.routes.js';
import { creditCardRoutes } from './modules/credit-cards/credit-card.routes.js';
import { transactionRoutes } from './modules/transactions/transaction.routes.js';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie'],
        censor: '[REDACTED]',
      },
    },
    bodyLimit: 1_048_576,
  });

  app.register(cookie, {
    hook: 'onRequest',
  });

  app.register(jwt, {
    secret: env.jwtAccessSecret,
    sign: {
      algorithm: 'HS256',
      expiresIn: env.accessTokenTtlSeconds,
      iss: 'finanzas-api',
      aud: 'finanzas-client',
    },
    verify: {
      algorithms: ['HS256'],
      allowedIss: 'finanzas-api',
      allowedAud: 'finanzas-client',
    },
  });

  app.register(rateLimit, {
    global: false,
    max: 100,
    timeWindow: '1 minute',
  });

  app.decorateRequest('auth', null);

  app.decorate('authenticate', authenticateRequest);

  app.register(authRoutes, {
    prefix: '/auth',
  });

  app.register(auditRoutes, {
    prefix: '/audit',
  });

  app.register(transactionRoutes, {
    prefix: '/transactions',
  });

  app.register(creditCardRoutes, {
    prefix: '/credit-cards',
  });

  app.register(accountRoutes, {
    prefix: '/accounts',
  });

  app.register(categoryRoutes, {
    prefix: '/categories',
  });

  app.get('/health', async () => ({
    status: 'ok',
  }));

  app.get('/ready', async (_request, reply) => {
    try {
      await db.query('SELECT 1');

      return {
        status: 'ready',
        dependencies: {
          database: 'ok',
        },
      };
    } catch (error) {
      app.log.error({ err: error }, 'Database readiness check failed');

      return reply.code(503).send({
        status: 'not_ready',
        dependencies: {
          database: 'unavailable',
        },
      });
    }
  });

  registerApiErrorHandler(app);

  app.addHook('onClose', async () => {
    await db.end();
  });

  return app;
}
