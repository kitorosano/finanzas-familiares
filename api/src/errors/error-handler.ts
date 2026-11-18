import type { FastifyInstance } from 'fastify';

import { AppError } from './app-error.js';

export function registerApiErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: error.code,
        message: error.message,
      });
    }

    const statusCode = (error as any).statusCode;
    const validation = (error as any).validation;

    if (statusCode === 429) {
      return reply.code(429).send({
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'Demasiados intentos. Esperá antes de volver a intentar.',
      });
    }

    if (validation) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Los datos enviados no son válidos',
      });
    }

    // Preserve Fastify client errors instead of converting them to HTTP 500.
    if (statusCode >= 400 && statusCode < 500) {
      request.log.warn({ err: error }, 'Request rejected');

      return reply.code(statusCode).send({
        error: statusCode === 415 ? 'UNSUPPORTED_MEDIA_TYPE' : 'REQUEST_ERROR',
        message:
          statusCode === 415
            ? 'Tipo de contenido no admitido. Utilizá application/json.'
            : 'La solicitud no pudo procesarse.',
      });
    }

    request.log.error({ err: error }, 'Unhandled API error');

    return reply.code(500).send({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Ocurrió un error interno',
    });
  });
}
