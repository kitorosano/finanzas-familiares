import { Pool } from 'pg';

import { requiredEnv } from '../utils/env.js';
import { isValidPort } from '../utils/validation.js';

const port = Number(process.env.DB_PORT ?? '5432');

if (!isValidPort(port)) {
  throw new Error('Invalid DB_PORT configuration');
}

export const db = new Pool({
  host: requiredEnv('DB_HOST'),
  port,
  database: requiredEnv('DB_NAME'),
  user: requiredEnv('DB_USER'),
  password: requiredEnv('DB_PASSWORD'),

  max: Number(process.env.DB_POOL_MAX ?? '10'),
  idleTimeoutMillis: 30_000, // 30 seconds
  connectionTimeoutMillis: 5_000, // 5 seconds

  application_name: 'finanzas-api',
});

db.on('error', (error: Error) => {
  console.error('[PostgreSQL] Unexpected idle client error:', error.message);
});
