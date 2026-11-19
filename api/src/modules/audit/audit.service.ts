import type { HouseholdScope } from '../authorization/authorization.types.js';

import { listAuditLogRows } from './audit.db.js';
import { decodeAuditCursor, encodeAuditCursor } from './audit.utils.js';

import type { AuditLogResult, AuditQuerystring } from './audit.types.js';

export async function listAuditLog(
  scope: HouseholdScope,
  query: AuditQuerystring,
): Promise<AuditLogResult> {
  const limit = query.limit ?? 50;
  const cursor = decodeAuditCursor(query.cursor);

  const rows = await listAuditLogRows(scope.householdId, {
    action: query.action,
    entityName: query.entityName,
    cursor,
    limit: limit + 1,
  });

  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);
  const lastRecord = data.at(-1);

  return {
    data,
    pagination: {
      limit,
      hasMore,
      nextCursor: hasMore && lastRecord ? encodeAuditCursor(lastRecord) : null,
    },
  };
}
