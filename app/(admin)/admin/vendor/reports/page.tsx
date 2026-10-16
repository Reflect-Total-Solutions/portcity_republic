'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import { Button } from '@/components/ui/button';
import { useVendorReports } from '@/hooks/useVendorReports';

function getTodayDateValue(): string {
  return formatInTimeZone(new Date(), 'Asia/Colombo', 'yyyy-MM-dd');
}

export default function VendorActivityReportPage() {
  const {
    activity,
    total,
    isLoading,
    isExporting,
    error,
    loadActivityReport,
    exportReport,
  } = useVendorReports();

  const [from, setFrom] = useState<string>(getTodayDateValue());
  const [to, setTo] = useState<string>(getTodayDateValue());
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');

  const [appliedFilters, setAppliedFilters] = useState<{
    from: string;
    to: string;
    startTime?: string;
    endTime?: string;
  }>({
    from: getTodayDateValue(),
    to: getTodayDateValue(),
  });

  const handleApply = () => {
    const filters = {
      from,
      to,
      startTime: startTime || undefined,
      endTime: endTime || undefined,
    };
    setAppliedFilters(filters);
    void loadActivityReport(filters);
  };

  const handleReset = () => {
    const today = getTodayDateValue();
    setFrom(today);
    setTo(today);
    setStartTime('');
    setEndTime('');
    const filters = { from: today, to: today };
    setAppliedFilters(filters);
    void loadActivityReport(filters);
  };

  useEffect(() => {
    void loadActivityReport(appliedFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalRevenue = useMemo(() => {
    return activity.reduce((sum, row) => sum + row.total_amount, 0);
  }, [activity]);

  const totalTickets = useMemo(() => {
    return activity.reduce((sum, row) => sum + row.total_count, 0);
  }, [activity]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1280px] p-4 text-slate-800 md:p-6 lg:p-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Your Activity Report</h2>
          <p className="mt-1 text-sm text-slate-500">
            View performance, income, and ticket counts for your assigned activities.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-slate-500">
            From Date
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="h-9 rounded-md border border-slate-300 px-3 text-sm text-slate-900"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-slate-500">
            To Date
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="h-9 rounded-md border border-slate-300 px-3 text-sm text-slate-900"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-slate-500">
            Start Time
            <input
              type="time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
              className="h-9 rounded-md border border-slate-300 px-3 text-sm text-slate-900"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-slate-500">
            End Time
            <input
              type="time"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              className="h-9 rounded-md border border-slate-300 px-3 text-sm text-slate-900"
            />
          </label>

          <Button
            type="button"
            onClick={handleApply}
            disabled={isLoading}
          >
            {isLoading ? 'Loading…' : 'Generate'}
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={handleReset}
            disabled={isLoading}
          >
            Reset
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={() => void exportReport('xlsx', appliedFilters)}
            disabled={isExporting || isLoading}
          >
            Export XLSX
          </Button>

          <Button
            type="button"
            onClick={() => void exportReport('pdf', appliedFilters)}
            disabled={isExporting || isLoading}
          >
            Export PDF
          </Button>
        </div>
      </div>

      {appliedFilters.startTime || appliedFilters.endTime ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-slate-600 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 w-fit">
          <span className="font-semibold text-slate-700">Active Window:</span>
          <span>
            {appliedFilters.from} {appliedFilters.startTime || '00:00'} → {appliedFilters.to}{' '}
            {appliedFilters.endTime || '23:59'} (Colombo Time)
          </span>
        </div>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-2 mt-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-sm font-medium text-slate-500 uppercase tracking-widest mb-1">Total Tickets Issued</div>
          <div className="text-3xl font-bold text-slate-900">{totalTickets}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-sm font-medium text-slate-500 uppercase tracking-widest mb-1">Total Income (LKR)</div>
          <div className="text-3xl font-bold text-slate-900">{totalRevenue.toFixed(2)}</div>
        </div>
      </div>

      {error ? (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-3 text-left font-semibold text-slate-500 uppercase tracking-wider text-xs">Activity</th>
                <th className="px-6 py-3 text-right font-semibold text-slate-500 uppercase tracking-wider text-xs">Local Count</th>
                <th className="px-6 py-3 text-right font-semibold text-slate-500 uppercase tracking-wider text-xs">Foreign Count</th>
                <th className="px-6 py-3 text-right font-semibold text-slate-500 uppercase tracking-wider text-xs">Total Tickets</th>
                <th className="px-6 py-3 text-right font-semibold text-slate-500 uppercase tracking-wider text-xs">Local Income</th>
                <th className="px-6 py-3 text-right font-semibold text-slate-500 uppercase tracking-wider text-xs">Foreign Income</th>
                <th className="px-6 py-3 text-right font-semibold text-slate-500 uppercase tracking-wider text-xs">Grand Total Income</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {activity.map((row) => (
                <tr key={row.activity_id} className="hover:bg-slate-50/50">
                  <td className="px-6 py-4 font-medium text-slate-900">{row.activity_name}</td>
                  <td className="px-6 py-4 text-right text-slate-600">{row.local_count}</td>
                  <td className="px-6 py-4 text-right text-slate-600">{row.foreign_count}</td>
                  <td className="px-6 py-4 text-right font-semibold text-slate-700">{row.total_count}</td>
                  <td className="px-6 py-4 text-right text-slate-600">{row.local_total.toFixed(2)}</td>
                  <td className="px-6 py-4 text-right text-slate-600">{row.foreign_total.toFixed(2)}</td>
                  <td className="px-6 py-4 text-right font-semibold text-slate-900">
                    {row.total_amount.toFixed(2)}
                  </td>
                </tr>
              ))}

              {!isLoading && activity.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-slate-500">
                    No ticket sales found for your assigned activities in this date range.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
