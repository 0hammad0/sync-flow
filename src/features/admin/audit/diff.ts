// Field-level before / after diff for the audit detail sheet. Pure, client-safe.

export type AuditData = Record<string, unknown> | null;

export type AuditDiffRow = { field: string; before: string; after: string; changed: boolean };

/** `—` for absent, JSON for objects and arrays, plain text otherwise. */
export function formatAuditValue(value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'string') return value === '' ? '""' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/**
 * One row per top-level field of `before` ∪ `after`, in first-seen order
 * (before's keys, then new keys from after). `changed` is false when both
 * sides print the same.
 */
export function diffAudit(before: AuditData, after: AuditData): AuditDiffRow[] {
  const fields = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  return fields.map((field) => {
    const from = formatAuditValue(before?.[field]);
    const to = formatAuditValue(after?.[field]);
    return { field, before: from, after: to, changed: from !== to };
  });
}
