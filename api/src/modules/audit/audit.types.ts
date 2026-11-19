export const AUDIT_ACTIONS = ['create', 'update', 'delete', 'void'] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditValues = Readonly<Record<string, unknown>>;

export interface AuditLogInput {
  action: AuditAction;
  entityName: string;
  entityId: string;
  oldValues?: AuditValues | null;
  newValues?: AuditValues | null;
}

export interface AuditQuerystring {
  limit?: number;
  cursor?: string;
  action?: AuditAction;
  entityName?: string;
}

export interface AuditLogRow {
  id: string;
  user_id: string | null;
  action: AuditAction;
  entity_name: string;
  entity_id: string;
  old_values: AuditValues | null;
  new_values: AuditValues | null;
  created_at: Date;
}

export interface AuditCursor {
  createdAt: string;
  id: string;
}

export interface AuditLogResult {
  data: AuditLogRow[];
  pagination: {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
}
