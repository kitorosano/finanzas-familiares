import type { PoolClient } from 'pg';

import { db } from './pool.js';

export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();

  let releaseError: Error | undefined;

  try {
    await client.query('BEGIN');

    const result = await callback(client);

    await client.query('COMMIT');

    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      releaseError =
        rollbackError instanceof Error
          ? rollbackError
          : new Error(String(rollbackError));
    }

    throw error;
  } finally {
    client.release(releaseError);
  }
}
