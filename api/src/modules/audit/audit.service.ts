import type { PoolClient } from 'pg';

import { db } from '../../db.js';

import type { HouseholdScope } from '../authorization/household-context.js';

import type {
  AuditCursor,
  AuditLogInput,
  AuditLogResult,
  AuditLogRow,
  AuditQuerystring,
} from './audit.types.js';

import { AppError } from '../../errors/app-error.js';

export async function writeAuditLog(
  client: PoolClient,
  scope: HouseholdScope,
  entry: AuditLogInput,
): Promise<void> {
  await client.query(
    `
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
    [
      scope.householdId,
      scope.userId,
      entry.action,
      entry.entityName,
      entry.entityId,
      entry.oldValues == null ? null : JSON.stringify(entry.oldValues),
      entry.newValues == null ? null : JSON.stringify(entry.newValues),
    ],
  );
}

function encodeCursor(row: AuditLogRow): string {
  const cursor: AuditCursor = {
    createdAt: row.created_at.toISOString(),
    id: row.id,
  };

  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(value?: string): AuditCursor | null {
  if (!value) return null;

  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) {
      throw new Error('Invalid cursor format');
    }

    const decoded: unknown = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    );

    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      !('createdAt' in decoded) ||
      !('id' in decoded) ||
      typeof decoded.createdAt !== 'string' ||
      typeof decoded.id !== 'string' ||
      !/^[1-9]\d*$/.test(decoded.id) ||
      Number.isNaN(Date.parse(decoded.createdAt))
    ) {
      throw new Error('Invalid cursor data');
    }

    return {
      createdAt: new Date(decoded.createdAt).toISOString(),
      id: decoded.id,
    };
  } catch {
    throw new AppError(
      400,
      'INVALID_AUDIT_CURSOR',
      'El cursor de auditoría no es válido',
    );
  }
}

export async function listAuditLog(
  scope: HouseholdScope,
  query: AuditQuerystring,
): Promise<AuditLogResult> {
  const limit = query.limit ?? 50;
  const cursor = decodeCursor(query.cursor);

  const result = await db.query<AuditLogRow>(
    `
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
    [
      scope.householdId,
      query.action ?? null,
      query.entityName ?? null,
      cursor?.createdAt ?? null,
      cursor?.id ?? null,
      limit + 1,
    ],
  );

  const hasMore = result.rows.length > limit;
  const data = result.rows.slice(0, limit);
  const lastRecord = data.at(-1);

  return {
    data,
    pagination: {
      limit,
      hasMore,
      nextCursor: hasMore && lastRecord ? encodeCursor(lastRecord) : null,
    },
  };
}
