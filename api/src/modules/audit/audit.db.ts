import type { PoolClient } from 'pg';

import { db } from '../../db/pool.js';

import type { HouseholdScope } from '../authorization/authorization.types.js';

import type {
  AuditAction,
  AuditCursor,
  AuditLogInput,
  AuditLogRow,
} from './audit.types.js';

const AUDIT_QUERIES = {
  insert: `
    INSERT INTO audit_log (
      household_id,
      user_id,
      action,
      entity_name,
      entity_id,
      old_values,
      new_values
    )
    VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
  `,
  list: `
    SELECT
      id::text AS id,
      user_id::text AS user_id,
      action,
      entity_name,
      entity_id::text AS entity_id,
      old_values,
      new_values,
      created_at

    FROM audit_log

    WHERE household_id = $1
      AND ($2::varchar IS NULL OR action = $2)
      AND ($3::varchar IS NULL OR entity_name = $3)
      AND (
        $4::timestamptz IS NULL
        OR (created_at, id) < ($4::timestamptz, $5::bigint)
      )

    ORDER BY created_at DESC, id DESC

    LIMIT $6
  `,
} as const;

export async function writeAuditLog(
  client: PoolClient,
  scope: HouseholdScope,
  entry: AuditLogInput,
): Promise<void> {
  await client.query(AUDIT_QUERIES.insert, [
    scope.householdId,
    scope.userId,
    entry.action,
    entry.entityName,
    entry.entityId,
    entry.oldValues == null ? null : JSON.stringify(entry.oldValues),
    entry.newValues == null ? null : JSON.stringify(entry.newValues),
  ]);
}

export async function listAuditLogRows(
  householdId: string,
  filters: {
    action: AuditAction | undefined;
    entityName: string | undefined;
    cursor: AuditCursor | null;
    limit: number;
  },
): Promise<AuditLogRow[]> {
  const result = await db.query<AuditLogRow>(AUDIT_QUERIES.list, [
    householdId,
    filters.action ?? null,
    filters.entityName ?? null,
    filters.cursor?.createdAt ?? null,
    filters.cursor?.id ?? null,
    filters.limit,
  ]);

  return result.rows;
}
