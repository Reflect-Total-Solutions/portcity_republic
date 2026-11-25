import { z } from 'zod';

export const BACKUP_FORMAT_VERSION = '1.0' as const;
export const BACKUP_APP_NAME = 'portcity-republic' as const;

/**
 * Tables in topological dependency order for safe upsert/restore.
 */
export const BACKUP_TABLES = [
  'users',
  'categories',
  'activities',
  'transaction_groups',
  'transactions',
  'tokens',
  'audit_log',
  'error_logs',
  'printer_status_cache',
] as const;

export type BackupTableName = (typeof BACKUP_TABLES)[number];

export type BackupTablesData = Record<BackupTableName, Record<string, unknown>[]>;

export interface BackupPayload {
  version: string;
  app: string;
  created_at: string;
  created_by: string | null;
  timezone: string;
  counts: Record<BackupTableName, number>;
  tables: BackupTablesData;
}

export const BackupPayloadSchema = z.object({
  version: z.string().min(1),
  app: z.literal(BACKUP_APP_NAME),
  created_at: z.string().min(1),
  created_by: z.string().nullable().optional(),
  timezone: z.string().optional(),
  counts: z.record(z.string(), z.number()).optional(),
  tables: z.object({
    users: z.array(z.record(z.string(), z.unknown())).default([]),
    categories: z.array(z.record(z.string(), z.unknown())).default([]),
    activities: z.array(z.record(z.string(), z.unknown())).default([]),
    transaction_groups: z.array(z.record(z.string(), z.unknown())).default([]),
    transactions: z.array(z.record(z.string(), z.unknown())).default([]),
    tokens: z.array(z.record(z.string(), z.unknown())).default([]),
    audit_log: z.array(z.record(z.string(), z.unknown())).default([]),
    error_logs: z.array(z.record(z.string(), z.unknown())).default([]),
    printer_status_cache: z.array(z.record(z.string(), z.unknown())).default([]),
  }),
});

export interface TableRestoreResult {
  table: BackupTableName;
  total: number;
  restored: number;
  skipped: number;
  error?: string;
}

function escapeSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function toSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'NULL';
  }
  if (typeof value === 'object') {
    return `${escapeSqlString(JSON.stringify(value))}::jsonb`;
  }
  return escapeSqlString(String(value));
}

function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

/**
 * Generates a PostgreSQL-compatible SQL backup script with idempotent
 * INSERT ... ON CONFLICT (id) DO UPDATE statements in dependency order.
 */
export function generateSqlBackup(backup: BackupPayload): string {
  const lines: string[] = [
    `-- Port City Republic Database Backup`,
    `-- Generated At: ${backup.created_at}`,
    `-- Created By: ${backup.created_by ?? 'unknown'}`,
    `-- Timezone: ${backup.timezone}`,
    ``,
    `BEGIN;`,
    ``,
  ];

  for (const table of BACKUP_TABLES) {
    const rows = backup.tables[table] ?? [];
    lines.push(`-- ============================================================================`);
    lines.push(`-- Table: public.${table} (${rows.length} rows)`);
    lines.push(`-- ============================================================================`);

    if (rows.length === 0) {
      lines.push(`-- (no rows)`);
      lines.push(``);
      continue;
    }

    // Collect union of all column names across rows
    const columnsSet = new Set<string>();
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        columnsSet.add(key);
      }
    }
    const columns = Array.from(columnsSet);
    const colList = columns.map(quoteIdent).join(', ');
    const updateCols = columns.filter((c) => c !== 'id');
    const updateClause =
      updateCols.length > 0
        ? updateCols.map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`).join(', ')
        : `${quoteIdent('id')} = EXCLUDED.${quoteIdent('id')}`;

    const isTransactions = table === 'transactions';

    for (const row of rows) {
      const effectiveRow = isTransactions
        ? {
            ...row,
            exchanged_to_transaction_id: null,
            exchanged_from_transaction_id: null,
          }
        : row;

      const valuesList = columns.map((col) => toSqlLiteral(effectiveRow[col])).join(', ');
      lines.push(
        `INSERT INTO public.${quoteIdent(table)} (${colList}) VALUES (${valuesList}) ON CONFLICT (${quoteIdent('id')}) DO UPDATE SET ${updateClause};`
      );
    }

    if (isTransactions) {
      const linkedRows = rows.filter(
        (r) => r.exchanged_to_transaction_id != null || r.exchanged_from_transaction_id != null
      );
      if (linkedRows.length > 0) {
        lines.push(``);
        lines.push(`-- Restore transaction exchange chain links`);
        for (const row of linkedRows) {
          if (typeof row.id !== 'string') continue;
          lines.push(
            `UPDATE public.${quoteIdent('transactions')} SET ${quoteIdent('exchanged_to_transaction_id')} = ${toSqlLiteral(row.exchanged_to_transaction_id ?? null)}, ${quoteIdent('exchanged_from_transaction_id')} = ${toSqlLiteral(row.exchanged_from_transaction_id ?? null)} WHERE ${quoteIdent('id')} = ${toSqlLiteral(row.id)};`
          );
        }
      }
    }

    lines.push(``);
  }

  lines.push(`COMMIT;`);
  lines.push(``);

  return lines.join('\n');
}
