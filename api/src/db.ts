
import { Pool } from 'pg';

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

const port = Number(process.env.DB_PORT ?? '5432');

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('Invalid DB_PORT configuration');
}

export const db = new Pool({
  host: requiredEnv('DB_HOST'),
  port,
  database: requiredEnv('DB_NAME'),
  user: requiredEnv('DB_USER'),
  password: requiredEnv('DB_PASSWORD'),
  max: Number(process.env.DB_POOL_MAX ?? '10'),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  application_name: 'finanzas-api'
});

db.on('error', (error: Error) => {
  console.error('[PostgreSQL] Unexpected idle client error:', error.message);
});
