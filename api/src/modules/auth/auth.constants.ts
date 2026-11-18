import argon2 from 'argon2';

import { env } from '../../config/env.js';

export const ARGON2_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export const REFRESH_TTL_MS = env.refreshTokenTtlSeconds * 1000;

export const REFRESH_COOKIE_NAME = 'finanzas_refresh';

export const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.isProduction,
  sameSite: 'strict' as const,
  path: '/auth',
  maxAge: env.refreshTokenTtlSeconds,
};
