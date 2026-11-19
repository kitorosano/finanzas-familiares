import argon2 from 'argon2';
import { createHmac, randomBytes } from 'node:crypto';

import type { FastifyInstance, FastifyReply } from 'fastify';
import type { PoolClient } from 'pg';

import { env } from '../../config/env.js';
import { AppError } from '../../errors/app-error.js';
import { ERROR_CODES } from '../../errors/error-codes.js';
import { ARGON2_OPTIONS, REFRESH_COOKIE_NAME } from './auth.constants.js';

import type { AuthHousehold, AuthResponse, AuthUser } from './auth.types.js';

let dummyHashPromise: Promise<string> | undefined;

export async function getDummyPasswordHash(): Promise<string> {
  dummyHashPromise ??= argon2.hash(
    randomBytes(32).toString('hex'),
    ARGON2_OPTIONS,
  );

  return dummyHashPromise;
}

export function hashRefreshToken(token: string): string {
  return createHmac('sha256', env.refreshTokenPepper)
    .update(token)
    .digest('hex');
}

export function createRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function createAccessToken(
  app: FastifyInstance,
  userId: string,
  sessionId: string,
  householdId: string,
): string {
  return app.jwt.sign({
    sub: userId,
    sid: sessionId,
    hid: householdId,
    tokenType: 'access',
  });
}

export function createAuthResponse(
  accessToken: string,
  user: AuthUser,
  household: AuthHousehold,
): AuthResponse {
  return {
    accessToken,
    tokenType: 'Bearer',
    expiresIn: env.accessTokenTtlSeconds,
    user,
    household,
  };
}

export function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'strict',
    path: '/auth',
  });
}

export function invalidCredentialsError(): AppError {
  return new AppError(
    401,
    ERROR_CODES.INVALID_CREDENTIALS,
    'Email o contraseña incorrectos',
  );
}

export async function rollbackSafely(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original database error.
  }
}
