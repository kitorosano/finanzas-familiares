import type { PoolClient } from 'pg';

export async function setAuditActor(
  client: PoolClient,
  userId: string,
): Promise<void> {
  await client.query(
    `
      SELECT set_config(
        'app.current_user_id',
        $1,
        TRUE
      )
    `,
    [userId],
  );
}
