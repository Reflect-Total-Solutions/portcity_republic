import { NextResponse } from 'next/server';

import {
  BACKUP_APP_NAME,
  BACKUP_FORMAT_VERSION,
  BACKUP_TABLES,
  BackupPayloadSchema,
  generateSqlBackup,
  type BackupPayload,
  type BackupTableName,
  type BackupTablesData,
  type TableRestoreResult,
} from '@/lib/backup';
import { ERROR_CODES, HTTP_STATUS, RATE_LIMITS, TIMEZONE_COLOMBO } from '@/lib/constants';
import { formatColomboDate } from '@/lib/dateUtils';
import { toApiError } from '@/lib/errors';
import { rateLimit } from '@/lib/rateLimit';
import { requireAdminRequestUser } from '@/lib/request-user';
import { supabaseServer } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 1000;
const UPSERT_CHUNK_SIZE = 500;

async function fetchAllRows(table: BackupTableName): Promise<Record<string, unknown>[]> {
  const allRows: Record<string, unknown>[] = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabaseServer
      .from(table)
      .select('*')
      .range(from, to);

    if (error) {
      throw error;
    }

    const batch = (data ?? []) as unknown as Record<string, unknown>[];
    allRows.push(...batch);

    if (batch.length < PAGE_SIZE) {
      break;
    }

    from += PAGE_SIZE;
  }

  return allRows;
}

async function countTableRows(table: BackupTableName): Promise<number> {
  const { count, error } = await supabaseServer
    .from(table)
    .select('*', { count: 'exact', head: true });

  if (error) {
    throw error;
  }

  return count ?? 0;
}

async function upsertInChunks(
  table: BackupTableName,
  rows: Record<string, unknown>[]
): Promise<number> {
  let restored = 0;

  for (let i = 0; i < rows.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK_SIZE);
    const { error } = await supabaseServer
      .from(table)
      .upsert(chunk as never, { onConflict: 'id' });

    if (error) {
      throw error;
    }

    restored += chunk.length;
  }

  return restored;
}

export async function GET(request: Request) {
  try {
    const admin = await requireAdminRequestUser();
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode');

    if (mode === 'summary') {
      const allowed = rateLimit(
        `admin:backup:summary:${admin.id}`,
        RATE_LIMITS.READ_OPERATIONS.attempts,
        RATE_LIMITS.READ_OPERATIONS.windowMs
      );

      if (!allowed) {
        return NextResponse.json(
          { error: 'Too many requests', code: ERROR_CODES.RATE_LIMIT_EXCEEDED },
          { status: HTTP_STATUS.RATE_LIMITED }
        );
      }

      const countsEntries = await Promise.all(
        BACKUP_TABLES.map(async (table) => [table, await countTableRows(table)] as const)
      );

      const counts = Object.fromEntries(countsEntries) as Record<BackupTableName, number>;
      return NextResponse.json({ data: { counts } }, { status: HTTP_STATUS.OK });
    }

    const allowed = rateLimit(
      `admin:backup:download:${admin.id}`,
      RATE_LIMITS.ADMIN_MUTATIONS.attempts,
      RATE_LIMITS.ADMIN_MUTATIONS.windowMs
    );

    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many requests', code: ERROR_CODES.RATE_LIMIT_EXCEEDED },
        { status: HTTP_STATUS.RATE_LIMITED }
      );
    }

    const tableEntries = await Promise.all(
      BACKUP_TABLES.map(async (table) => [table, await fetchAllRows(table)] as const)
    );

    const tables = Object.fromEntries(tableEntries) as BackupTablesData;
    const counts = Object.fromEntries(
      BACKUP_TABLES.map((table) => [table, tables[table].length])
    ) as Record<BackupTableName, number>;

    const backup: BackupPayload = {
      version: BACKUP_FORMAT_VERSION,
      app: BACKUP_APP_NAME,
      created_at: new Date().toISOString(),
      created_by: admin.email ?? admin.id,
      timezone: TIMEZONE_COLOMBO,
      counts,
      tables,
    };

    // Best-effort audit log entry
    const formatParam = searchParams.get('format')?.toLowerCase() === 'sql' ? 'sql' : 'json';

    try {
      await supabaseServer.from('audit_log').insert({
        user_id: admin.id,
        action: 'BACKUP_DOWNLOAD',
        entity_type: 'database',
        metadata: { format: formatParam, counts },
      } as never);
    } catch (auditErr) {
      console.error('Backup download audit_log insert failed (non-fatal):', auditErr);
    }

    const timestamp = formatColomboDate(new Date(), 'yyyy-MM-dd-HH-mm-ss');

    if (formatParam === 'sql') {
      const sqlContent = generateSqlBackup(backup);
      const sqlFilename = `portcity-backup-${timestamp}.sql`;

      return new Response(sqlContent, {
        status: HTTP_STATUS.OK,
        headers: {
          'Content-Type': 'application/sql; charset=utf-8',
          'Content-Disposition': `attachment; filename="${sqlFilename}"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    const filename = `portcity-backup-${timestamp}.json`;

    return new Response(JSON.stringify(backup, null, 2), {
      status: HTTP_STATUS.OK,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const apiError = toApiError(error);
    return NextResponse.json(
      {
        error: apiError.message,
        code: apiError.code,
        details: apiError.details,
      },
      { status: apiError.statusCode }
    );
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdminRequestUser();

    const allowed = rateLimit(
      `admin:backup:restore:${admin.id}`,
      RATE_LIMITS.ADMIN_MUTATIONS.attempts,
      RATE_LIMITS.ADMIN_MUTATIONS.windowMs
    );

    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many requests', code: ERROR_CODES.RATE_LIMIT_EXCEEDED },
        { status: HTTP_STATUS.RATE_LIMITED }
      );
    }

    const rawBody = await request.json().catch(() => null);
    const parsed = BackupPayloadSchema.safeParse(rawBody);

    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      return NextResponse.json(
        {
          error: 'Invalid backup file format',
          code: ERROR_CODES.VALIDATION_ERROR,
          details: issues,
        },
        { status: HTTP_STATUS.BAD_REQUEST }
      );
    }

    const tables = parsed.data.tables;
    const results: TableRestoreResult[] = [];
    const warnings: string[] = [];

    // Fetch existing auth.users IDs so we don't fail on public.users FK to auth.users(id)
    const authUserIds = new Set<string>();
    try {
      let page = 1;
      while (true) {
        const { data: authList, error: authErr } = await supabaseServer.auth.admin.listUsers({
          page,
          perPage: 1000,
        });
        if (authErr) throw authErr;
        const usersList = authList?.users ?? [];
        for (const u of usersList) {
          authUserIds.add(u.id);
        }
        if (usersList.length < 1000) break;
        page += 1;
      }
    } catch (authListErr) {
      warnings.push(
        `Could not verify auth.users list (${authListErr instanceof Error ? authListErr.message : 'unknown error'}).`
      );
    }

    for (const table of BACKUP_TABLES) {
      const rows = tables[table] ?? [];

      if (rows.length === 0) {
        results.push({ table, total: 0, restored: 0, skipped: 0 });
        continue;
      }

      try {
        if (table === 'users' && authUserIds.size > 0) {
          const validUsers = rows.filter(
            (row) => typeof row.id === 'string' && authUserIds.has(row.id)
          );
          const skippedCount = rows.length - validUsers.length;
          const restored = validUsers.length > 0 ? await upsertInChunks('users', validUsers) : 0;

          if (skippedCount > 0) {
            warnings.push(
              `Skipped ${skippedCount} user record(s) because their Auth account does not exist in Supabase Auth.`
            );
          }

          results.push({
            table,
            total: rows.length,
            restored,
            skipped: skippedCount,
          });
          continue;
        }

        if (table === 'transactions') {
          // Pass 1: Upsert without self-referential exchange links so row order never violates FK
          const pass1Rows = rows.map((row) => ({
            ...row,
            exchanged_to_transaction_id: null,
            exchanged_from_transaction_id: null,
          }));
          const restored = await upsertInChunks('transactions', pass1Rows);

          // Pass 2: Restore exchange chain links
          const linkedRows = rows.filter(
            (row) =>
              row.exchanged_to_transaction_id != null ||
              row.exchanged_from_transaction_id != null
          );

          for (const row of linkedRows) {
            if (typeof row.id !== 'string') continue;
            const { error: linkErr } = await supabaseServer
              .from('transactions')
              .update({
                exchanged_to_transaction_id: row.exchanged_to_transaction_id ?? null,
                exchanged_from_transaction_id: row.exchanged_from_transaction_id ?? null,
              } as never)
              .eq('id', row.id);

            if (linkErr) {
              throw linkErr;
            }
          }

          results.push({ table, total: rows.length, restored, skipped: 0 });
          continue;
        }

        const restored = await upsertInChunks(table, rows);
        results.push({ table, total: rows.length, restored, skipped: 0 });
      } catch (tableErr) {
        const msg =
          tableErr instanceof Error
            ? tableErr.message
            : typeof tableErr === 'object' && tableErr !== null && 'message' in tableErr
              ? String((tableErr as { message: unknown }).message)
              : 'Upsert failed';

        results.push({
          table,
          total: rows.length,
          restored: 0,
          skipped: rows.length,
          error: msg,
        });
        warnings.push(`Table "${table}" restore error: ${msg}`);
      }
    }

    // Best-effort audit log entry
    try {
      await supabaseServer.from('audit_log').insert({
        user_id: admin.id,
        action: 'BACKUP_RESTORE',
        entity_type: 'database',
        metadata: {
          backup_created_at: parsed.data.created_at,
          results,
          warnings,
        },
      } as never);
    } catch (auditErr) {
      console.error('Backup restore audit_log insert failed (non-fatal):', auditErr);
    }

    const hasTableError = results.some((r) => Boolean(r.error));

    return NextResponse.json(
      {
        success: !hasTableError,
        data: {
          results,
          warnings,
          restored_at: new Date().toISOString(),
        },
      },
      { status: hasTableError ? HTTP_STATUS.BAD_REQUEST : HTTP_STATUS.OK }
    );
  } catch (error) {
    const apiError = toApiError(error);
    return NextResponse.json(
      {
        error: apiError.message,
        code: apiError.code,
        details: apiError.details,
      },
      { status: apiError.statusCode }
    );
  }
}
