import type { SupabaseClient } from '@supabase/supabase-js';

import { computeShiftWindowUtc, formatColomboDate, formatColomboDateTime } from '@/lib/dateUtils';
import { ForbiddenError, ValidationError } from '@/lib/errors';
import type { RequestUserContext } from '@/lib/request-user';
import type { Database } from '@/types/database';
import type {
  ActivityReportRow,
  CashierActivityBreakdown,
  CashierReportRow,
  DailyActivityBreakdown,
  DailyReportRow,
  ShiftReportRow,
  ShiftReportWindow,
  TransactionReportRow,
} from '@/types/report';

export type ReportQueryParams = {
  date?: string;
  from?: string;
  to?: string;
  start_time?: string;
  end_time?: string;
  cashier_id?: string;
  activity_id?: string;
  price_type?: 'local' | 'foreign';
  include_cancelled?: boolean;
  page?: number;
  limit?: number;
};

type ReportSupabaseClient = SupabaseClient<Database>;

type DailySummaryViewRow = Database['public']['Views']['daily_summary']['Row'];
type TransactionRow = Database['public']['Tables']['transactions']['Row'];

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

function clampPagination(page = 1, limit = 50) {
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const safeLimit = Number.isFinite(limit)
    ? Math.min(500, Math.max(1, Math.floor(limit)))
    : 50;

  return {
    page: safePage,
    limit: safeLimit,
  };
}

function parseDateParam(rawValue: string | null, key: string): string | undefined {
  if (!rawValue) {
    return undefined;
  }

  if (!ISO_DATE_REGEX.test(rawValue)) {
    throw new ValidationError(`Invalid ${key}. Expected YYYY-MM-DD format.`);
  }

  return rawValue;
}

function parseTimeParam(rawValue: string | null, key: string): string | undefined {
  if (!rawValue) {
    return undefined;
  }

  if (!TIME_REGEX.test(rawValue)) {
    throw new ValidationError(`Invalid ${key}. Expected HH:mm format (24-hour).`);
  }

  return rawValue;
}

function parseBooleanParam(rawValue: string | null): boolean | undefined {
  if (rawValue === null) {
    return undefined;
  }

  if (rawValue === 'true') {
    return true;
  }

  if (rawValue === 'false') {
    return false;
  }

  throw new ValidationError('Invalid boolean value. Expected true or false.');
}

export function parseReportQueryParams(url: string): ReportQueryParams {
  const searchParams = new URL(url).searchParams;
  const date = parseDateParam(searchParams.get('date'), 'date');
  const from = parseDateParam(searchParams.get('from'), 'from');
  const to = parseDateParam(searchParams.get('to'), 'to');

  if (date && (from || to)) {
    throw new ValidationError('Use either date or from/to filters, not both.');
  }

  if (from && to && from > to) {
    throw new ValidationError('Invalid date range. from must be before or equal to to.');
  }

  const priceType = searchParams.get('price_type');
  let parsedPriceType: 'local' | 'foreign' | undefined;

  if (priceType) {
    if (priceType !== 'local' && priceType !== 'foreign') {
      throw new ValidationError('Invalid price_type. Expected local or foreign.');
    }

    parsedPriceType = priceType;
  }

  const pageValue = searchParams.get('page');
  const limitValue = searchParams.get('limit');
  const parsedPage = pageValue ? Number.parseInt(pageValue, 10) : undefined;
  const parsedLimit = limitValue ? Number.parseInt(limitValue, 10) : undefined;

  if (pageValue && (!Number.isFinite(parsedPage) || (parsedPage ?? 0) < 1)) {
    throw new ValidationError('Invalid page. Expected positive integer.');
  }

  if (limitValue && (!Number.isFinite(parsedLimit) || (parsedLimit ?? 0) < 1)) {
    throw new ValidationError('Invalid limit. Expected positive integer.');
  }

  return {
    date,
    from,
    to,
    start_time: parseTimeParam(searchParams.get('start_time'), 'start_time'),
    end_time: parseTimeParam(searchParams.get('end_time'), 'end_time'),
    cashier_id: searchParams.get('cashier_id') ?? undefined,
    activity_id: searchParams.get('activity_id') ?? undefined,
    price_type: parsedPriceType,
    include_cancelled: parseBooleanParam(searchParams.get('include_cancelled')),
    page: parsedPage,
    limit: parsedLimit,
  };
}

function ensureAdminOrVendor(requestUser: RequestUserContext) {
  if (requestUser.role !== 'admin' && requestUser.role !== 'vendor') {
    throw new ForbiddenError('Forbidden');
  }
}

function toNumber(value: number | null | undefined): number {
  return Number(value ?? 0);
}

function getOrCreateActivityBreakdown(
  activitiesMap: Map<string, DailyActivityBreakdown>,
  activityId: string,
  activityName: string
): DailyActivityBreakdown {
  const existing = activitiesMap.get(activityId);

  if (existing) {
    return existing;
  }

  const created: DailyActivityBreakdown = {
    activity_id: activityId,
    activity_name: activityName,
    local_count: 0,
    local_total: 0,
    foreign_count: 0,
    foreign_total: 0,
  };

  activitiesMap.set(activityId, created);
  return created;
}

export async function fetchDailyReportData(
  supabase: ReportSupabaseClient,
  requestUser: RequestUserContext,
  params: ReportQueryParams
): Promise<DailyReportRow[]> {
  let query = supabase
    .from('daily_summary')
    .select('*')
    .order('sale_date', { ascending: false })
    .limit(50000);

  if (params.date) {
    query = query.eq('sale_date', params.date);
  } else {
    if (params.from) {
      query = query.gte('sale_date', params.from);
    }

    if (params.to) {
      query = query.lte('sale_date', params.to);
    }
  }

  if (requestUser.role === 'vendor') {
    query = query.eq('vendor_id', requestUser.id);
  } else if (requestUser.role !== 'admin') {
    query = query.eq('cashier_id', requestUser.id);
  } else if (params.cashier_id) {
    query = query.eq('cashier_id', params.cashier_id);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as DailySummaryViewRow[];
  const cashierIds = Array.from(
    new Set(rows.map((row) => row.cashier_id).filter((value): value is string => Boolean(value)))
  );

  const cashierNameMap = new Map<string, string>();

  if (cashierIds.length > 0) {
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, display_name')
      .in('id', cashierIds);

    if (usersError) {
      throw usersError;
    }

    for (const user of (users ?? []) as Array<{ id: string; display_name: string }>) {
      cashierNameMap.set(user.id, user.display_name);
    }
  }

  const grouped = new Map<
    string,
    {
      row: DailyReportRow;
      activityMap: Map<string, DailyActivityBreakdown>;
    }
  >();

  for (const summaryRow of rows) {
    if (!summaryRow.cashier_id || !summaryRow.sale_date) {
      continue;
    }

    const key = `${summaryRow.sale_date}|${summaryRow.cashier_id}`;
    const count = toNumber(summaryRow.count);
    const amount = toNumber(summaryRow.total_amount);

    const existing = grouped.get(key);
    const entity =
      existing ??
      {
        row: {
          date: summaryRow.sale_date,
          cashier_id: summaryRow.cashier_id,
          cashier_name:
            cashierNameMap.get(summaryRow.cashier_id) ??
            `Cashier ${summaryRow.cashier_id.slice(0, 8)}`,
          activities: [],
          totals: {
            total_transactions: 0,
            total_local_amount: 0,
            total_foreign_amount: 0,
            total_cash_amount: 0,
            total_card_amount: 0,
            total_amount: 0,
          },
        },
        activityMap: new Map<string, DailyActivityBreakdown>(),
      };

    entity.row.totals.total_transactions += count;
    entity.row.totals.total_amount = Number((entity.row.totals.total_amount + amount).toFixed(2));

    // Handle payment method summary
    if ((summaryRow as Record<string, unknown>).payment_method === 'card') {
      entity.row.totals.total_card_amount = Number((entity.row.totals.total_card_amount + amount).toFixed(2));
    } else {
      entity.row.totals.total_cash_amount = Number((entity.row.totals.total_cash_amount + amount).toFixed(2));
    }

    if (summaryRow.price_type === 'local') {
      entity.row.totals.total_local_amount = Number(
        (entity.row.totals.total_local_amount + amount).toFixed(2)
      );
    }

    if (summaryRow.price_type === 'foreign') {
      entity.row.totals.total_foreign_amount = Number(
        (entity.row.totals.total_foreign_amount + amount).toFixed(2)
      );
    }

    if (summaryRow.activity_id) {
      const activity = getOrCreateActivityBreakdown(
        entity.activityMap,
        summaryRow.activity_id,
        summaryRow.activity_name ?? `Activity ${summaryRow.activity_id.slice(0, 8)}`
      );

      if (summaryRow.price_type === 'local') {
        activity.local_count += count;
        activity.local_total = Number((activity.local_total + amount).toFixed(2));
      } else {
        activity.foreign_count += count;
        activity.foreign_total = Number((activity.foreign_total + amount).toFixed(2));
      }
    }

    grouped.set(key, entity);
  }

  return Array.from(grouped.values())
    .map((item) => ({
      ...item.row,
      activities: Array.from(item.activityMap.values()).sort((a, b) =>
        a.activity_name.localeCompare(b.activity_name)
      ),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export async function fetchActivityReportData(
  supabase: ReportSupabaseClient,
  requestUser: RequestUserContext,
  params: ReportQueryParams
): Promise<ActivityReportRow[]> {
  ensureAdminOrVendor(requestUser);

  const hasTimeFilter = Boolean(params.start_time || params.end_time);

  if (!hasTimeFilter) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc('get_activity_report_data', {
      p_from:        params.date ?? params.from ?? null,
      p_to:          params.date ?? params.to   ?? null,
      p_vendor_id:   requestUser.role === 'vendor' ? requestUser.id : null,
      p_activity_id: params.activity_id ?? null,
      p_cashier_id:  params.cashier_id  ?? null,
    });

    if (error) {
      throw error;
    }

    return (data ?? []).map((row: Record<string, unknown>) => ({
      activity_id:   row.activity_id   as string,
      activity_name: (row.activity_name as string | null) ?? `Activity ${(row.activity_id as string).slice(0, 8)}`,
      local_count:   toNumber(row.local_count   as number | null),
      foreign_count: toNumber(row.foreign_count as number | null),
      total_count:   toNumber(row.total_count   as number | null),
      local_total:   toNumber(row.local_total   as number | null),
      foreign_total: toNumber(row.foreign_total as number | null),
      total_amount:  toNumber(row.total_amount  as number | null),
    }));
  }

  const fromDate = params.date ?? params.from ?? formatColomboDate(new Date(), 'yyyy-MM-dd');
  const toDate = params.date ?? params.to ?? fromDate;
  const startTime = params.start_time ?? '00:00';
  const endTime = params.end_time ?? '23:59';

  let startUtc: Date;
  let endUtc: Date;
  try {
    const window = computeShiftWindowUtc(fromDate, toDate, startTime, endTime);
    startUtc = window.startUtc;
    endUtc = window.endUtc;
  } catch (err) {
    throw new ValidationError(
      err instanceof Error ? err.message : 'Invalid time range: end must be after start.'
    );
  }

  // Include transactions right through the final minute of the window
  const adjustedEndUtc = new Date(endUtc.getTime() + 59 * 1000 + 999);

  let vendorActivityIds: string[] | null = null;
  if (requestUser.role === 'vendor') {
    const { data: vActs, error: vError } = await supabase
      .from('activities')
      .select('id')
      .eq('vendor_id', requestUser.id);

    if (vError) throw vError;
    vendorActivityIds = ((vActs ?? []) as Array<{ id: string }>).map((a) => a.id);
    if (vendorActivityIds.length === 0) {
      return [];
    }
  }

  const ACTIVITY_PAGE_SIZE = 1000;
  const ACTIVITY_ROW_CAP = 50000;

  type ActivityTxRow = {
    activity_id: string;
    price_type: 'local' | 'foreign';
    amount: number;
    cancelled_at: string | null;
  };

  const activityMap = new Map<string, ActivityReportRow>();

  for (let offset = 0; offset < ACTIVITY_ROW_CAP; offset += ACTIVITY_PAGE_SIZE) {
    let query = supabase
      .from('transactions')
      .select('activity_id, price_type, amount, cancelled_at', { count: 'exact' })
      .gte('created_at', startUtc.toISOString())
      .lte('created_at', adjustedEndUtc.toISOString())
      .is('cancelled_at', null)
      .range(offset, offset + ACTIVITY_PAGE_SIZE - 1);

    if (requestUser.role === 'vendor' && vendorActivityIds) {
      query = query.in('activity_id', vendorActivityIds);
    }

    if (params.activity_id) {
      query = query.eq('activity_id', params.activity_id);
    }

    if (params.cashier_id) {
      query = query.eq('cashier_id', params.cashier_id);
    }

    const { data, error, count } = await query;
    if (error) {
      throw error;
    }

    const pageRows = (data ?? []) as ActivityTxRow[];
    for (const tx of pageRows) {
      let row = activityMap.get(tx.activity_id);
      if (!row) {
        row = {
          activity_id: tx.activity_id,
          activity_name: `Activity ${tx.activity_id.slice(0, 8)}`,
          local_count: 0,
          foreign_count: 0,
          total_count: 0,
          local_total: 0,
          foreign_total: 0,
          total_amount: 0,
        };
        activityMap.set(tx.activity_id, row);
      }

      const amt = Number(tx.amount || 0);
      row.total_count += 1;
      row.total_amount = Number((row.total_amount + amt).toFixed(2));

      if (tx.price_type === 'local') {
        row.local_count += 1;
        row.local_total = Number((row.local_total + amt).toFixed(2));
      } else {
        row.foreign_count += 1;
        row.foreign_total = Number((row.foreign_total + amt).toFixed(2));
      }
    }

    if (pageRows.length < ACTIVITY_PAGE_SIZE || (count !== null && offset + pageRows.length >= count)) {
      break;
    }
  }

  const uniqueActivityIds = Array.from(activityMap.keys());
  if (uniqueActivityIds.length > 0) {
    const { data: acts, error: actError } = await supabase
      .from('activities')
      .select('id, name')
      .in('id', uniqueActivityIds);

    if (!actError && acts) {
      for (const act of acts as Array<{ id: string; name: string }>) {
        const item = activityMap.get(act.id);
        if (item) {
          item.activity_name = act.name;
        }
      }
    }
  }

  return Array.from(activityMap.values()).sort((a, b) => b.total_amount - a.total_amount);
}

export async function fetchCashierReportData(
  supabase: ReportSupabaseClient,
  requestUser: RequestUserContext,
  params: ReportQueryParams
): Promise<CashierReportRow[]> {
  ensureAdminOrVendor(requestUser);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('get_cashier_report_data', {
    p_from:        params.date ?? params.from ?? null,
    p_to:          params.date ?? params.to   ?? null,
    p_vendor_id:   requestUser.role === 'vendor' ? requestUser.id : null,
    p_cashier_id:  params.cashier_id ?? null,
    p_activity_id: params.activity_id ?? null,
  });

  if (error) {
    throw error;
  }

  // Group by cashier, with activities nested inside
  const grouped = new Map<
    string,
    {
      cashier_id: string;
      cashier_name: string;
      local_count: number;
      foreign_count: number;
      total_transactions: number;
      local_total: number;
      foreign_total: number;
      cash_total: number;
      card_total: number;
      total_amount: number;
      activities: CashierActivityBreakdown[];
    }
  >();

  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const cashierId = row.cashier_id as string;
    const activityId = row.activity_id as string;

    // Get or create the cashier entry
    if (!grouped.has(cashierId)) {
      grouped.set(cashierId, {
        cashier_id: cashierId,
        cashier_name: (row.cashier_name as string | null) ?? `Cashier ${cashierId.slice(0, 8)}`,
        local_count: 0,
        foreign_count: 0,
        total_transactions: 0,
        local_total: 0,
        foreign_total: 0,
        cash_total: 0,
        card_total: 0,
        total_amount: 0,
        activities: [],
      });
    }

    const cashier = grouped.get(cashierId)!;

    // Accumulate cashier totals
    const localCount = toNumber(row.local_count as number | null);
    const foreignCount = toNumber(row.foreign_count as number | null);
    const localTotal = toNumber(row.local_total as number | null);
    const foreignTotal = toNumber(row.foreign_total as number | null);
    const cashTotal = toNumber(row.cash_total as number | null);
    const cardTotal = toNumber(row.card_total as number | null);
    const total = toNumber(row.total_amount as number | null);

    cashier.local_count += localCount;
    cashier.foreign_count += foreignCount;
    cashier.total_transactions += localCount + foreignCount;
    cashier.local_total = Number((cashier.local_total + localTotal).toFixed(2));
    cashier.foreign_total = Number((cashier.foreign_total + foreignTotal).toFixed(2));
    cashier.cash_total = Number((cashier.cash_total + cashTotal).toFixed(2));
    cashier.card_total = Number((cashier.card_total + cardTotal).toFixed(2));
    cashier.total_amount = Number((cashier.total_amount + total).toFixed(2));

    // Add activity breakdown
    cashier.activities.push({
      activity_id: activityId,
      activity_name:
        (row.activity_name as string | null) ?? `Activity ${activityId.slice(0, 8)}`,
      local_count: localCount,
      local_total: localTotal,
      foreign_count: foreignCount,
      foreign_total: foreignTotal,
      cash_total: cashTotal,
      card_total: cardTotal,
      total_amount: total,
    });
  }

  // Convert to array and sort by total amount (desc)
  return Array.from(grouped.values())
    .map((cashier) => ({
      ...cashier,
      activities: cashier.activities.sort((a, b) => b.total_amount - a.total_amount),
    }))
    .sort((a, b) => b.total_amount - a.total_amount);
}

export async function fetchTransactionsReportData(
  supabase: ReportSupabaseClient,
  requestUser: RequestUserContext,
  params: ReportQueryParams
): Promise<{
  data: TransactionReportRow[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}> {
  ensureAdminOrVendor(requestUser);

  const { page, limit } = clampPagination(params.page, params.limit);
  const offset = (page - 1) * limit;

  let query = supabase
    .from('transactions')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (params.cashier_id) {
    query = query.eq('cashier_id', params.cashier_id);
  }

  if (requestUser.role === 'vendor') { query = query.eq('vendor_id', requestUser.id); }
    if (params.activity_id) {
    query = query.eq('activity_id', params.activity_id);
  }

  if (params.price_type) {
    query = query.eq('price_type', params.price_type);
  }

  if (params.from) {
    query = query.gte('created_at', `${params.from}T00:00:00.000Z`);
  }

  if (params.to) {
    query = query.lte('created_at', `${params.to}T23:59:59.999Z`);
  }

  if (!params.include_cancelled) {
    query = query.is('cancelled_at', null);
  }

  const { data, error, count } = await query;

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as TransactionRow[];
  const activityIds = Array.from(new Set(rows.map((row) => row.activity_id)));
  const cashierIds = Array.from(new Set(rows.map((row) => row.cashier_id)));
  const transactionIds = rows.map((row) => row.id);

  const activityNameMap = new Map<string, string>();
  const cashierNameMap = new Map<string, string>();
  const tokenMap = new Map<string, { token_number: string | null; reprint_count: number }>();

  await Promise.all([
    (async () => {
      if (activityIds.length === 0) return;
      const { data: activities, error: activitiesError } = await supabase
        .from('activities')
        .select('id, name')
        .in('id', activityIds);
      if (activitiesError) throw activitiesError;
      for (const activity of (activities ?? []) as Array<{ id: string; name: string }>) {
        activityNameMap.set(activity.id, activity.name);
      }
    })(),
    (async () => {
      if (cashierIds.length === 0) return;
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id, display_name')
        .in('id', cashierIds);
      if (usersError) throw usersError;
      for (const user of (users ?? []) as Array<{ id: string; display_name: string }>) {
        cashierNameMap.set(user.id, user.display_name);
      }
    })(),
    (async () => {
      if (transactionIds.length === 0) return;
      const { data: tokens, error: tokensError } = await supabase
        .from('tokens')
        .select('transaction_id, token_number, reprint_count')
        .in('transaction_id', transactionIds);
      if (tokensError) throw tokensError;
      for (const token of (tokens ?? []) as Array<{
        transaction_id: string;
        token_number: string;
        reprint_count: number;
      }>) {
        tokenMap.set(token.transaction_id, {
          token_number: token.token_number,
          reprint_count: token.reprint_count,
        });
      }
    })(),
  ]);

  const output: TransactionReportRow[] = rows.map((row) => {
    const token = tokenMap.get(row.id);

    return {
      id: row.id,
      token_number: token?.token_number ?? null,
      txn_reference: row.txn_reference,
      activity_id: row.activity_id,
      activity_name: activityNameMap.get(row.activity_id) ?? row.activity_id,
      cashier_id: row.cashier_id,
      cashier_name: cashierNameMap.get(row.cashier_id) ?? row.cashier_id,
      price_type: row.price_type,
      amount: row.amount,
      print_status: row.print_status,
      created_at: row.created_at,
      cancelled_at: row.cancelled_at,
      reprint_count: token?.reprint_count ?? 0,
    };
  });

  const total = count ?? output.length;

  return {
    data: output,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}

const SHIFT_DEFAULT_START_TIME = '16:00';
const SHIFT_DEFAULT_END_TIME = '02:00';
const SHIFT_ROW_CAP = 10000;
const SHIFT_PAGE_SIZE = 1000;

export async function fetchShiftReportData(
  supabase: ReportSupabaseClient,
  requestUser: RequestUserContext,
  params: ReportQueryParams
): Promise<{
  data: ShiftReportRow[];
  total: number;
  total_amount: number;
  window: ShiftReportWindow;
}> {
  if (requestUser.role !== 'admin') {
    throw new ForbiddenError('Forbidden');
  }

  if (!params.from || !params.to) {
    throw new ValidationError('Shift report requires from and to dates.');
  }

  const startTime = params.start_time ?? SHIFT_DEFAULT_START_TIME;
  const endTime = params.end_time ?? SHIFT_DEFAULT_END_TIME;
  const { startUtc, endUtc } = computeShiftWindowUtc(params.from, params.to, startTime, endTime);

  type ShiftSourceRow = Pick<
    TransactionRow,
    'id' | 'txn_reference' | 'cashier_id' | 'activity_id' | 'price_type' | 'amount' | 'created_at' | 'cancelled_at'
  >;

  // PostgREST caps each response at its server-side `max-rows` setting (1000
  // by default), so `.limit()` alone silently truncates large windows. Page
  // through with `.range()` until every row in the window is fetched, so the
  // grand total and exports always cover everything.
  const rows: ShiftSourceRow[] = [];
  let total = 0;

  for (let offset = 0; offset < SHIFT_ROW_CAP; offset += SHIFT_PAGE_SIZE) {
    let query = supabase
      .from('transactions')
      .select('id, txn_reference, cashier_id, activity_id, price_type, amount, created_at, cancelled_at', {
        count: 'exact',
      })
      .gte('created_at', startUtc.toISOString())
      .lt('created_at', endUtc.toISOString())
      .order('txn_reference', { ascending: true })
      .range(offset, offset + SHIFT_PAGE_SIZE - 1);

    if (params.cashier_id) {
      query = query.eq('cashier_id', params.cashier_id);
    }

    if (params.activity_id) {
      query = query.eq('activity_id', params.activity_id);
    }

    const { data, error, count } = await query;

    if (error) {
      throw error;
    }

    total = count ?? total;

    const pageRows = (data ?? []) as ShiftSourceRow[];
    rows.push(...pageRows);

    if (pageRows.length < SHIFT_PAGE_SIZE || rows.length >= total) {
      break;
    }
  }

  const activityIds = Array.from(new Set(rows.map((row) => row.activity_id)));
  const cashierIds = Array.from(new Set(rows.map((row) => row.cashier_id)));

  const activityNameMap = new Map<string, string>();
  const cashierNameMap = new Map<string, string>();

  await Promise.all([
    (async () => {
      if (activityIds.length === 0) return;
      const { data: activities, error: activitiesError } = await supabase
        .from('activities')
        .select('id, name')
        .in('id', activityIds);
      if (activitiesError) throw activitiesError;
      for (const activity of (activities ?? []) as Array<{ id: string; name: string }>) {
        activityNameMap.set(activity.id, activity.name);
      }
    })(),
    (async () => {
      if (cashierIds.length === 0) return;
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id, display_name')
        .in('id', cashierIds);
      if (usersError) throw usersError;
      for (const user of (users ?? []) as Array<{ id: string; display_name: string }>) {
        cashierNameMap.set(user.id, user.display_name);
      }
    })(),
  ]);

  const output: ShiftReportRow[] = rows.map((row) => ({
    id: row.id,
    txn_reference: row.txn_reference,
    cashier_id: row.cashier_id,
    cashier_name: cashierNameMap.get(row.cashier_id) ?? row.cashier_id,
    activity_id: row.activity_id,
    activity_name: activityNameMap.get(row.activity_id) ?? row.activity_id,
    price_type: row.price_type,
    amount: Number(row.amount),
    created_at: row.created_at,
    cancelled_at: row.cancelled_at,
  }));

  const totalAmount = Number(
    output
      .filter((row) => !row.cancelled_at)
      .reduce((sum, row) => sum + row.amount, 0)
      .toFixed(2)
  );

  return {
    data: output,
    total: total || output.length,
    total_amount: totalAmount,
    window: {
      start_utc: startUtc.toISOString(),
      end_utc: endUtc.toISOString(),
      start_local: formatColomboDateTime(startUtc),
      end_local: formatColomboDateTime(endUtc),
    },
  };
}
