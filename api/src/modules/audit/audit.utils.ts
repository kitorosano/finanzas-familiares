import {
  AUDIT_CURSOR_ID_PATTERN,
  AUDIT_CURSOR_PATTERN,
} from '../../constants/patterns.js';
import { AppError } from '../../errors/app-error.js';
import { ERROR_CODES } from '../../errors/error-codes.js';

import type { AuditCursor, AuditLogRow } from './audit.types.js';

const auditCursorRegex = new RegExp(AUDIT_CURSOR_PATTERN);
const auditCursorIdRegex = new RegExp(AUDIT_CURSOR_ID_PATTERN);

export function encodeAuditCursor(row: AuditLogRow): string {
  const cursor: AuditCursor = {
    createdAt: row.created_at.toISOString(),
    id: row.id,
  };

  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeAuditCursor(value?: string): AuditCursor | null {
  if (!value) return null;

  try {
    if (!auditCursorRegex.test(value)) {
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
      !auditCursorIdRegex.test(decoded.id) ||
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
      ERROR_CODES.INVALID_AUDIT_CURSOR,
      'El cursor de auditoría no es válido',
    );
  }
}
