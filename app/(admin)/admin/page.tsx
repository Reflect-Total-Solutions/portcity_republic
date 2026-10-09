'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatInTimeZone } from 'date-fns-tz';
import { subDays } from 'date-fns';
import { useAuth } from '@/hooks/useAuth';
import { 
  Users, 
  Activity, 
  FolderTree, 
  LineChart, 
  Printer, 
  AlertCircle,
  RefreshCcw,
  CheckCircle2,
  Trophy,
  TrendingUp,
  Flame,
  Ticket,
  CircleDollarSign,
  BarChart3,
  Search,
  SlidersHorizontal,
  ArrowUpRight,
  Medal,
  Sparkles
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ActivityReportRow } from '@/types/report';

type MaintenancePayload = {
  counts: {
    users: number;
    active_users: number;
    activities: number;
    active_activities: number;
    categories: number;
    todays_transactions: number;
    pending_prints: number;
  };
  recent_errors: Array<{ id: string; message: string; created_at: string }>;
  refreshed_at: string;
};

type TimeRangeFilter = 'today' | '7d' | '30d' | 'all';
type SortMetric = 'count' | 'amount';

function formatCurrency(amount: number): string {
  return `Rs. ${amount.toLocaleString('en-LK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const { user } = useAuth();

  // Maintenance & System stats
  const [maintenanceData, setMaintenanceData] = useState<MaintenancePayload | null>(null);
  const [isLoadingMaintenance, setIsLoadingMaintenance] = useState(true);

  // Most Selling Games / Activities Data
  const [activitiesData, setActivitiesData] = useState<ActivityReportRow[]>([]);
  const [isLoadingActivities, setIsLoadingActivities] = useState(true);
  const [activitiesError, setActivitiesError] = useState<string | null>(null);

  // Filters & Controls
  const [timeRange, setTimeRange] = useState<TimeRangeFilter>('all');
  const [sortMetric, setSortMetric] = useState<SortMetric>('count');
  const [displayLimit, setDisplayLimit] = useState<number>(10);
  const [searchQuery, setSearchQuery] = useState('');

  // General error
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.role === 'vendor') {
      router.push('/admin/reports');
    }
  }, [user, router]);

  // Calculate Colombo date ranges
  const dateParams = useMemo(() => {
    const todayStr = formatInTimeZone(new Date(), 'Asia/Colombo', 'yyyy-MM-dd');
    if (timeRange === 'today') {
      return { from: todayStr, to: todayStr };
    }
    if (timeRange === '7d') {
      const fromStr = formatInTimeZone(subDays(new Date(), 7), 'Asia/Colombo', 'yyyy-MM-dd');
      return { from: fromStr, to: todayStr };
    }
    if (timeRange === '30d') {
      const fromStr = formatInTimeZone(subDays(new Date(), 30), 'Asia/Colombo', 'yyyy-MM-dd');
      return { from: fromStr, to: todayStr };
    }
    return {}; // 'all' time: no date filter
  }, [timeRange]);

  // Fetch Maintenance Overview
  async function loadMaintenanceData() {
    setIsLoadingMaintenance(true);
    try {
      const res = await fetch('/api/admin/maintenance', { method: 'GET', cache: 'no-store' });
      const payload = (await res.json()) as { data?: MaintenancePayload; error?: string };
      if (!res.ok || !payload.data) {
        setMaintenanceData(null);
        setError(payload.error ?? 'Unable to load admin maintenance data');
      } else {
        setMaintenanceData(payload.data);
      }
    } catch {
      setMaintenanceData(null);
      setError('Unable to load admin maintenance data');
    } finally {
      setIsLoadingMaintenance(false);
    }
  }

  // Fetch Activity Sales Analytics
  async function loadActivitiesData() {
    setIsLoadingActivities(true);
    setActivitiesError(null);
    try {
      const searchParams = new URLSearchParams();
      if (dateParams.from) searchParams.set('from', dateParams.from);
      if (dateParams.to) searchParams.set('to', dateParams.to);

      const url = `/api/reports/activity${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
      const res = await fetch(url, { method: 'GET', cache: 'no-store' });
      const payload = (await res.json()) as { data?: ActivityReportRow[]; error?: string };

      if (!res.ok || !payload.data) {
        setActivitiesData([]);
        setActivitiesError(payload.error ?? 'Unable to load game sales');
      } else {
        setActivitiesData(payload.data);
      }
    } catch {
      setActivitiesData([]);
      setActivitiesError('Network error while loading game sales');
    } finally {
      setIsLoadingActivities(false);
    }
  }

  // Refresh All
  async function handleRefreshAll() {
    await Promise.all([loadMaintenanceData(), loadActivitiesData()]);
  }

  useEffect(() => {
    void loadMaintenanceData();
  }, []);

  useEffect(() => {
    void loadActivitiesData();
  }, [dateParams]);

  // Calculated totals across all activities
  const summaryTotals = useMemo(() => {
    const totalTickets = activitiesData.reduce((acc, item) => acc + item.total_count, 0);
    const totalRevenue = activitiesData.reduce((acc, item) => acc + item.total_amount, 0);
    const totalLocalTickets = activitiesData.reduce((acc, item) => acc + item.local_count, 0);
    const totalForeignTickets = activitiesData.reduce((acc, item) => acc + item.foreign_count, 0);
    const activeSellingActivities = activitiesData.filter((a) => a.total_count > 0).length;

    return {
      totalTickets,
      totalRevenue,
      totalLocalTickets,
      totalForeignTickets,
      activeSellingActivities,
    };
  }, [activitiesData]);

  // Sorted activities based on selected metric
  const sortedActivities = useMemo(() => {
    const list = [...activitiesData];
    list.sort((a, b) => {
      if (sortMetric === 'count') {
        if (b.total_count !== a.total_count) {
          return b.total_count - a.total_count;
        }
        return b.total_amount - a.total_amount;
      }
      if (b.total_amount !== a.total_amount) {
        return b.total_amount - a.total_amount;
      }
      return b.total_count - a.total_count;
    });
    return list;
  }, [activitiesData, sortMetric]);

  // Top Most Selling Game (#1 Winner)
  const topSellingGame = useMemo(() => {
    if (sortedActivities.length === 0 || sortedActivities[0].total_count === 0) {
      return null;
    }
    return sortedActivities[0];
  }, [sortedActivities]);

  // Maximum value for proportional bar chart
  const maxMetricValue = useMemo(() => {
    if (sortedActivities.length === 0) return 1;
    const topItem = sortedActivities[0];
    return sortMetric === 'count' ? Math.max(1, topItem.total_count) : Math.max(1, topItem.total_amount);
  }, [sortedActivities, sortMetric]);

  // Filtered list for display & search
  const displayedActivities = useMemo(() => {
    let list = sortedActivities;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((a) => a.activity_name.toLowerCase().includes(q));
    }
    if (displayLimit > 0) {
      list = list.slice(0, displayLimit);
    }
    return list;
  }, [sortedActivities, searchQuery, displayLimit]);

  const isGlobalLoading = isLoadingMaintenance || isLoadingActivities;

  return (
    <div className="max-w-[1400px] pb-16">
      {/* Header Bar */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between px-1">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-emerald-700 border border-emerald-200">
              <Sparkles className="w-3 h-3 text-emerald-600" /> Executive Analytics
            </span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Admin Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">
            Real-time performance metrics, operational health, and most selling game details
          </p>
        </div>

        {/* Global Actions & Period Filter */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex rounded-xl bg-slate-100 p-1 border border-slate-200 shadow-inner">
            <button
              type="button"
              onClick={() => setTimeRange('today')}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
                timeRange === 'today'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setTimeRange('7d')}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
                timeRange === '7d'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              7 Days
            </button>
            <button
              type="button"
              onClick={() => setTimeRange('30d')}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
                timeRange === '30d'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              30 Days
            </button>
            <button
              type="button"
              onClick={() => setTimeRange('all')}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
                timeRange === 'all'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Time
            </button>
          </div>

          <Button 
            type="button" 
            variant="outline" 
            onClick={() => void handleRefreshAll()} 
            disabled={isGlobalLoading}
            className="h-9 px-3.5 font-semibold shadow-sm bg-white hover:bg-slate-50 text-slate-700 transition-colors"
          >
            <RefreshCcw className={`w-3.5 h-3.5 mr-2 ${isGlobalLoading ? 'animate-spin opacity-50' : 'text-slate-500'}`} strokeWidth={2.5}/>
            {isGlobalLoading ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50/50 p-4 text-sm font-medium text-red-800 flex items-center shadow-sm">
          <AlertCircle className="w-5 h-5 mr-3 text-red-500 shrink-0" />
          {error}
        </div>
      ) : null}

      {/* KPI Top Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        {/* Total Game Revenue */}
        <div className="rounded-2xl border-2 border-slate-200 bg-gradient-to-br from-white to-emerald-50/40 p-5 shadow-sm hover:shadow-md transition-all duration-200">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Total Games Revenue</p>
              <p className="mt-2 text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
                {isLoadingActivities ? '...' : formatCurrency(summaryTotals.totalRevenue)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {timeRange === 'all' ? 'All recorded sales' : `For selected period (${timeRange})`}
              </p>
            </div>
            <div className="p-3 bg-emerald-100 text-emerald-700 rounded-xl">
              <CircleDollarSign className="w-5 h-5" strokeWidth={2.5} />
            </div>
          </div>
        </div>

        {/* Total Tickets Sold */}
        <div className="rounded-2xl border-2 border-slate-200 bg-gradient-to-br from-white to-blue-50/40 p-5 shadow-sm hover:shadow-md transition-all duration-200">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-blue-700">Total Tickets Sold</p>
              <p className="mt-2 text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
                {isLoadingActivities ? '...' : summaryTotals.totalTickets.toLocaleString()}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Local: <span className="font-semibold text-slate-700">{summaryTotals.totalLocalTickets.toLocaleString()}</span> • Foreign: <span className="font-semibold text-slate-700">{summaryTotals.totalForeignTickets.toLocaleString()}</span>
              </p>
            </div>
            <div className="p-3 bg-blue-100 text-blue-700 rounded-xl">
              <Ticket className="w-5 h-5" strokeWidth={2.5} />
            </div>
          </div>
        </div>

        {/* Active Selling Activities */}
        <div className="rounded-2xl border-2 border-slate-200 bg-gradient-to-br from-white to-purple-50/40 p-5 shadow-sm hover:shadow-md transition-all duration-200">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-purple-700">Attractions Selling</p>
              <p className="mt-2 text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
                {isLoadingActivities ? '...' : `${summaryTotals.activeSellingActivities} Games`}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Out of {maintenanceData?.counts.activities ?? activitiesData.length} registered activities
              </p>
            </div>
            <div className="p-3 bg-purple-100 text-purple-700 rounded-xl">
              <Activity className="w-5 h-5" strokeWidth={2.5} />
            </div>
          </div>
        </div>

        {/* Top Performer Share */}
        <div className="rounded-2xl border-2 border-slate-200 bg-gradient-to-br from-white to-amber-50/40 p-5 shadow-sm hover:shadow-md transition-all duration-200">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-amber-700">#1 Top Game Share</p>
              <p className="mt-2 text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
                {topSellingGame && summaryTotals.totalTickets > 0
                  ? `${((topSellingGame.total_count / summaryTotals.totalTickets) * 100).toFixed(1)}%`
                  : '—'}
              </p>
              <p className="mt-1 text-xs text-slate-500 truncate max-w-[180px]">
                Leader: <span className="font-semibold text-slate-700">{topSellingGame?.activity_name ?? 'None'}</span>
              </p>
            </div>
            <div className="p-3 bg-amber-100 text-amber-700 rounded-xl">
              <Trophy className="w-5 h-5" strokeWidth={2.5} />
            </div>
          </div>
        </div>
      </div>

      {/* Hero Showcase: #1 Most Selling Game Spotlight */}
      {topSellingGame && (
        <div className="mb-8 overflow-hidden rounded-3xl border-3 border-amber-300 bg-gradient-to-r from-amber-500 via-amber-600 to-yellow-600 p-6 sm:p-8 text-white shadow-xl relative">
          <div className="absolute right-[-20px] top-[-20px] opacity-10 pointer-events-none">
            <Trophy className="w-72 h-72 text-white" />
          </div>

          <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-black/20 px-3.5 py-1 text-xs font-extrabold uppercase tracking-widest text-yellow-200 backdrop-blur-md mb-3 border border-yellow-300/30">
                <Flame className="w-4 h-4 text-yellow-300 fill-yellow-300" /> #1 MOST POPULAR ATTRACTION ({timeRange.toUpperCase()})
              </div>
              <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-white drop-shadow-sm">
                {topSellingGame.activity_name}
              </h2>
              <p className="mt-2 text-sm sm:text-base text-amber-100 font-medium leading-relaxed">
                Dominating carnival sales with{' '}
                <span className="font-black text-white underline decoration-yellow-300 underline-offset-4">
                  {topSellingGame.total_count.toLocaleString()} tickets sold
                </span>{' '}
                and generating{' '}
                <span className="font-black text-white">
                  {formatCurrency(topSellingGame.total_amount)}
                </span>{' '}
                in gross revenue.
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-3 text-xs sm:text-sm font-semibold text-amber-100">
                <span className="bg-white/20 px-3 py-1 rounded-lg backdrop-blur-sm">
                  🎟️ Local: {topSellingGame.local_count.toLocaleString()} ({formatCurrency(topSellingGame.local_total)})
                </span>
                {topSellingGame.foreign_count > 0 && (
                  <span className="bg-white/20 px-3 py-1 rounded-lg backdrop-blur-sm">
                    🌐 Foreign: {topSellingGame.foreign_count.toLocaleString()} ({formatCurrency(topSellingGame.foreign_total)})
                  </span>
                )}
                <span className="bg-white/20 px-3 py-1 rounded-lg backdrop-blur-sm">
                  📊 {summaryTotals.totalRevenue > 0 ? `${((topSellingGame.total_amount / summaryTotals.totalRevenue) * 100).toFixed(1)}% of total park revenue` : ''}
                </span>
              </div>
            </div>

            {/* Quick Badge Stats */}
            <div className="flex sm:flex-row lg:flex-col gap-3 shrink-0">
              <div className="rounded-2xl bg-white/15 p-4 backdrop-blur-md border border-white/25 flex-1 lg:w-56 text-center">
                <p className="text-[11px] font-bold uppercase tracking-wider text-amber-200">Tickets Issued</p>
                <p className="text-3xl font-black text-white mt-0.5">{topSellingGame.total_count.toLocaleString()}</p>
              </div>
              <div className="rounded-2xl bg-white/15 p-4 backdrop-blur-md border border-white/25 flex-1 lg:w-56 text-center">
                <p className="text-[11px] font-bold uppercase tracking-wider text-amber-200">Revenue</p>
                <p className="text-2xl font-black text-white mt-0.5">{formatCurrency(topSellingGame.total_amount)}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Most Selling Visual Chart & Rankings */}
      <div className="rounded-3xl border-2 border-slate-200 bg-white p-6 sm:p-8 shadow-sm mb-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between pb-6 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-emerald-600" />
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
                Most Selling Games Chart
              </h2>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Visual ranking and performance breakdown of attractions by ticket sales volume and revenue
            </p>
          </div>

          {/* Metric Selector & Limit */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-xl bg-slate-100 p-1 border border-slate-200">
              <button
                type="button"
                onClick={() => setSortMetric('count')}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
                  sortMetric === 'count'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Sort by Tickets Sold (Qty)
              </button>
              <button
                type="button"
                onClick={() => setSortMetric('amount')}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
                  sortMetric === 'amount'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Sort by Revenue (LKR)
              </button>
            </div>

            <div className="flex rounded-xl bg-slate-100 p-1 border border-slate-200">
              {[5, 10, 20].map((lim) => (
                <button
                  key={lim}
                  type="button"
                  onClick={() => setDisplayLimit(lim)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition-all ${
                    displayLimit === lim
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Top {lim}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setDisplayLimit(activitiesData.length || 100)}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition-all ${
                  displayLimit > 20
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All
              </button>
            </div>
          </div>
        </div>

        {/* Visual Bar Chart */}
        {isLoadingActivities ? (
          <div className="py-20 text-center">
            <RefreshCcw className="w-8 h-8 mx-auto text-emerald-600 animate-spin opacity-60 mb-3" />
            <p className="text-sm font-semibold text-slate-600">Loading most selling activities chart...</p>
          </div>
        ) : displayedActivities.length === 0 ? (
          <div className="py-16 text-center">
            <Ticket className="w-12 h-12 mx-auto text-slate-300 mb-3" />
            <p className="text-base font-bold text-slate-700">No ticket sales recorded for this period</p>
            <p className="text-xs text-slate-400 mt-1">Try switching to &quot;All Time&quot; or check back once cashiers issue tickets.</p>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {displayedActivities.map((item, index) => {
              const rank = index + 1;
              const isTop1 = rank === 1;
              const isTop2 = rank === 2;
              const isTop3 = rank === 3;

              const metricVal = sortMetric === 'count' ? item.total_count : item.total_amount;
              const percentOfMax = Math.min(100, Math.max(4, Math.round((metricVal / maxMetricValue) * 100)));
              const shareOfTotal = summaryTotals.totalTickets > 0
                ? ((item.total_count / summaryTotals.totalTickets) * 100).toFixed(1)
                : '0.0';

              return (
                <div 
                  key={item.activity_id}
                  className={`group relative rounded-2xl border p-4 transition-all duration-200 ${
                    isTop1 
                      ? 'border-amber-300 bg-amber-50/30 shadow-sm' 
                      : isTop2 
                        ? 'border-slate-300 bg-slate-50/40' 
                        : isTop3 
                          ? 'border-amber-200/70 bg-amber-50/10' 
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2.5">
                    {/* Game Name & Rank Badge */}
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-xl font-extrabold text-xs flex items-center justify-center shrink-0 shadow-sm ${
                        isTop1
                          ? 'bg-gradient-to-br from-amber-400 to-yellow-500 text-white'
                          : isTop2
                            ? 'bg-gradient-to-br from-slate-300 to-slate-400 text-slate-900'
                            : isTop3
                              ? 'bg-gradient-to-br from-amber-600 to-yellow-700 text-white'
                              : 'bg-slate-100 text-slate-600 border border-slate-200'
                      }`}>
                        {isTop1 ? '🥇 1' : isTop2 ? '🥈 2' : isTop3 ? '🥉 3' : `#${rank}`}
                      </div>

                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-base font-extrabold text-slate-900 group-hover:text-emerald-700 transition-colors">
                            {item.activity_name}
                          </p>
                          {isTop1 && (
                            <span className="inline-flex items-center rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-amber-800">
                              Top Seller
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500">
                          Local: <span className="font-semibold text-slate-700">{item.local_count}</span>
                          {item.foreign_count > 0 && (
                            <> • Foreign: <span className="font-semibold text-slate-700">{item.foreign_count}</span></>
                          )}
                        </p>
                      </div>
                    </div>

                    {/* Numeric Summary Values */}
                    <div className="flex items-center gap-4 sm:text-right shrink-0">
                      <div>
                        <p className="text-base font-black text-slate-900">
                          {item.total_count.toLocaleString()} Tickets
                        </p>
                        <p className="text-xs font-semibold text-emerald-600">
                          {formatCurrency(item.total_amount)}
                        </p>
                      </div>

                      <div className="min-w-[60px] text-right">
                        <span className="inline-block rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700 border border-slate-200">
                          {shareOfTotal}% share
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Proportional Bar Indicator */}
                  <div className="relative h-3 w-full overflow-hidden rounded-full bg-slate-100 shadow-inner">
                    <div 
                      className={`h-full rounded-full transition-all duration-500 ${
                        isTop1 
                          ? 'bg-gradient-to-r from-amber-500 to-yellow-400' 
                          : isTop2 
                            ? 'bg-gradient-to-r from-blue-500 to-cyan-400' 
                            : isTop3 
                              ? 'bg-gradient-to-r from-emerald-500 to-teal-400' 
                              : 'bg-gradient-to-r from-slate-600 to-slate-400'
                      }`}
                      style={{ width: `${percentOfMax}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Comprehensive Game Sales Breakdown Table */}
      <div className="rounded-3xl border-2 border-slate-200 bg-white shadow-sm overflow-hidden mb-8">
        <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-slate-50/50">
          <div>
            <h3 className="text-lg font-bold text-slate-900">All Game Sales & Revenue Breakdown</h3>
            <p className="text-xs text-slate-500 mt-0.5">Complete table view of activity counts, revenue, and local vs foreign distribution</p>
          </div>

          {/* Table Search Filter */}
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search attraction..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 text-xs font-semibold text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-xs sm:text-sm">
            <thead className="bg-slate-100/70 text-slate-700">
              <tr>
                <th className="px-4 py-3 text-left font-bold uppercase tracking-wider">Rank</th>
                <th className="px-4 py-3 text-left font-bold uppercase tracking-wider">Attraction / Game</th>
                <th className="px-4 py-3 text-right font-bold uppercase tracking-wider">Local Qty</th>
                <th className="px-4 py-3 text-right font-bold uppercase tracking-wider">Foreign Qty</th>
                <th className="px-4 py-3 text-right font-bold uppercase tracking-wider">Total Tickets</th>
                <th className="px-4 py-3 text-right font-bold uppercase tracking-wider">Total Revenue</th>
                <th className="px-4 py-3 text-right font-bold uppercase tracking-wider">Market Share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {displayedActivities.map((row, idx) => {
                const rank = idx + 1;
                const share = summaryTotals.totalTickets > 0
                  ? ((row.total_count / summaryTotals.totalTickets) * 100).toFixed(1)
                  : '0.0';

                return (
                  <tr key={row.activity_id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-4 py-3.5 font-bold text-slate-700">
                      {rank === 1 ? '🥇 1' : rank === 2 ? '🥈 2' : rank === 3 ? '🥉 3' : `#${rank}`}
                    </td>
                    <td className="px-4 py-3.5 font-extrabold text-slate-900">
                      {row.activity_name}
                    </td>
                    <td className="px-4 py-3.5 text-right font-medium text-slate-600">
                      {row.local_count.toLocaleString()}
                    </td>
                    <td className="px-4 py-3.5 text-right font-medium text-slate-600">
                      {row.foreign_count.toLocaleString()}
                    </td>
                    <td className="px-4 py-3.5 text-right font-extrabold text-slate-900">
                      {row.total_count.toLocaleString()}
                    </td>
                    <td className="px-4 py-3.5 text-right font-bold text-emerald-700">
                      {formatCurrency(row.total_amount)}
                    </td>
                    <td className="px-4 py-3.5 text-right font-bold text-slate-700">
                      <span className="inline-block rounded-md bg-slate-100 px-2 py-0.5 text-xs border border-slate-200">
                        {share}%
                      </span>
                    </td>
                  </tr>
                );
              })}

              {!isLoadingActivities && displayedActivities.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-500 font-medium">
                    No matching activity records found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* System Infrastructure & Alerts (Printer & Maintenance Cards) */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 lg:gap-8">
        {/* Printer Status Card */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm flex flex-col">
          <div className="p-6 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-slate-100 text-slate-600 rounded-xl">
                <Printer className="w-5 h-5" strokeWidth={2.5} />
              </div>
              <h2 className="text-base font-bold text-slate-900">Thermal Receipt Printer</h2>
            </div>
            <div className="px-3 py-1 text-xs font-bold uppercase tracking-wider rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              Direct RAW ESC/POS + Browser
            </div>
          </div>
          
          <div className="p-6 flex-1 bg-slate-50/50 rounded-b-2xl flex flex-col justify-center">
            <p className="text-sm font-medium text-slate-700 mb-2 leading-relaxed">
              Ticket receipts and Cash Drawer kicks are sent directly to your installed thermal receipt printer via Windows Spooler and browser drivers.
            </p>
            <p className="text-xs text-slate-500">
              Auto-cutting and cash drawer pulses are triggered immediately upon payment confirmation at checkout.
            </p>
          </div>
        </div>

        {/* Recent System Alerts */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm flex flex-col">
          <div className="p-6 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-slate-100 text-slate-600 rounded-xl">
                <AlertCircle className="w-5 h-5" strokeWidth={2.5} />
              </div>
              <h2 className="text-base font-bold text-slate-900">System Alerts & Health</h2>
            </div>
            <div className="px-3 py-1 bg-slate-100 text-slate-600 text-xs font-bold rounded-full">
              {maintenanceData?.recent_errors.length ?? 0}
            </div>
          </div>

          <div className="p-6 flex-1 rounded-b-2xl">
            {maintenanceData?.recent_errors && maintenanceData.recent_errors.length > 0 ? (
              <div className="space-y-3">
                {maintenanceData.recent_errors.slice(0, 3).map((err) => (
                  <div key={err.id} className="flex gap-4 p-3 rounded-xl border border-slate-100 bg-slate-50/50">
                    <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-slate-800 line-clamp-2 leading-relaxed">{err.message}</p>
                      <p className="mt-1.5 text-xs text-slate-500 font-medium">
                        {new Date(err.created_at).toLocaleString('en-LK', {
                          month: 'short', day: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center py-6 text-center">
                <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-500 flex items-center justify-center mb-3">
                  <CheckCircle2 className="w-6 h-6" strokeWidth={2.5} />
                </div>
                <p className="text-sm font-semibold tracking-tight text-slate-900 mb-1">All systems nominal</p>
                <p className="text-xs font-medium text-slate-500">No critical errors or printer faults detected</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-8 text-center sm:text-right">
        {maintenanceData?.refreshed_at && (
          <p className="text-[11px] font-medium uppercase tracking-widest text-slate-400">
            Last updated • {new Date(maintenanceData.refreshed_at).toLocaleTimeString('en-LK')}
          </p>
        )}
      </div>
    </div>
  );
}
