import Fastify, { type FastifyInstance } from 'fastify';

import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';

import { env } from './config/env.js';
import { db } from './db.js';
import { registerApiErrorHandler } from './errors/error-handler.js';
import { authenticateRequest } from './modules/auth/authenticate.js';
import { authRoutes } from './modules/auth/auth.routes.js';

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
