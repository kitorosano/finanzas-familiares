import { requiredEnv } from '../utils/env.js';

function requiredSecret(name: string): string {
  const errorMessage = `${name} must be configured with at least 32 bytes`;
  const value = requiredEnv(name, errorMessage);

  if (Buffer.byteLength(value, 'utf8') < 32) {
    throw new Error(errorMessage);
  }

  return value;
}

function positiveIntegerEnv(name: string): number {
  const errorMessage = `${name} must be a positive integer`;
  const rawValue = requiredEnv(name, errorMessage);
  const value = Number(rawValue);

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(errorMessage);
  }

  return value;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';

if (!['development', 'test', 'production'].includes(nodeEnv)) {
  throw new Error(`Invalid NODE_ENV: ${nodeEnv}`);
}

export const env = Object.freeze({
  nodeEnv,
  isProduction: nodeEnv === 'production',

  jwtAccessSecret: requiredSecret('JWT_ACCESS_SECRET'),
  refreshTokenPepper: requiredSecret('REFRESH_TOKEN_PEPPER'),

  accessTokenTtlSeconds: positiveIntegerEnv('ACCESS_TOKEN_TTL_SECONDS'),
  refreshTokenTtlSeconds: positiveIntegerEnv('REFRESH_TOKEN_TTL_SECONDS'),
});
