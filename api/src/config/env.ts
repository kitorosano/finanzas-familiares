function requiredSecret(name: string): string {
  const value = process.env[name];

  if (!value || Buffer.byteLength(value, 'utf8') < 32) {
    throw new Error(`${name} must be configured with at least 32 bytes`);
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

  accessTokenTtlSeconds: 15 * 60,
  refreshTokenTtlSeconds: 30 * 24 * 60 * 60,
});
