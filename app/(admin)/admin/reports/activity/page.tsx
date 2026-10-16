'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { formatInTimeZone } from 'date-fns-tz';
import { Button } from '@/components/ui/button';
import { useReports } from '@/hooks/useReports';

function getTodayDateValue(): string {
  return formatInTimeZone(new Date(), 'Asia/Colombo', 'yyyy-MM-dd');
}

export default function ActivityReportPage() {
  const {
    activity,
    total,
    isLoading,
    isExporting,
    error,
    loadActivityReport,
    exportReport,
  } = useReports();

  const [from, setFrom] = useState<string>(getTodayDateValue());
  const [to, setTo] = useState<string>(getTodayDateValue());
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');
  const [activityId, setActivityId] = useState('');
  const [activitiesList, setActivitiesList] = useState<Array<{ id: string; name: string }>>([]);

  // Fetch list of activities for dropdown
  useEffect(() => {
    async function fetchActivities() {
      try {
        const res = await fetch('/api/activities?limit=100');
        if (res.ok) {
          const json = await res.json();
          setActivitiesList(json.data ?? []);
        }
      } catch {
        // ignore error
      }
    }
    void fetchActivities();
  }, []);

  const [appliedFilters, setAppliedFilters] = useState<{
    from: string;
    to: string;
    startTime?: string;
    endTime?: string;
    activityId?: string;
  }>({
    from: getTodayDateValue(),
    to: getTodayDateValue(),
  });

  const handleApply = useCallback(() => {
    const filters = {
      from,
      to,
      startTime: startTime || undefined,
      endTime: endTime || undefined,
      activityId: activityId || undefined,
    };
    setAppliedFilters(filters);
    void loadActivityReport(filters);
  }, [activityId, endTime, from, loadActivityReport, startTime, to]);

  const handleReset = useCallback(() => {
    const today = getTodayDateValue();
    setFrom(today);
    setTo(today);
    setStartTime('');
    setEndTime('');
    setActivityId('');
    const filters = {
      from: today,
      to: today,
    };
    setAppliedFilters(filters);
    void loadActivityReport(filters);
  }, [loadActivityReport]);

  const handleSetShiftPreset = useCallback(() => {
    setStartTime('16:00');
    setEndTime('02:00');
  }, []);

  const handleClearTimes = useCallback(() => {
    setStartTime('');
    setEndTime('');
  }, []);

  // Initial load
  useEffect(() => {
    void loadActivityReport(appliedFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = useMemo(() => {
    return activity.reduce(
      (acc, row) => ({
        local_count: acc.local_count + row.local_count,
        foreign_count: acc.foreign_count + row.foreign_count,
        total_count: acc.total_count + row.total_count,
        local_total: acc.local_total + row.local_total,
        foreign_total: acc.foreign_total + row.foreign_total,
        total_amount: acc.total_amount + row.total_amount,
      }),
      {
        local_count: 0,
        foreign_count: 0,
        total_count: 0,
        local_total: 0,
        foreign_total: 0,
        total_amount: 0,
      }
    );
  }, [activity]);

  return (
    <div>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Activity Report</h2>
            <p className="mt-1 text-sm text-slate-600">
              Revenue and count distribution by activity. Filter by date range and operating hours.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleSetShiftPreset}
              className="text-xs"
            >
              Preset: Shift (16:00 - 02:00)
            </Button>
            {(startTime || endTime) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClearTimes}
                className="text-xs text-slate-500 hover:text-slate-900"
              >
                Clear Times
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-7 items-end">
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

          <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-slate-500">
            Activity
            <select
              value={activityId}
              onChange={(event) => setActivityId(event.target.value)}
              className="h-9 rounded-md border border-slate-300 px-2 text-sm text-slate-900 bg-white"
            >
              <option value="">All Activities</option>
              {activitiesList.map((act) => (
                <option key={act.id} value={act.id}>
                  {act.name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex gap-2 lg:col-span-2">
            <Button
              type="button"
              onClick={handleApply}
              disabled={isLoading}
              className="flex-1"
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
              onClick={() => void exportReport('activity', 'xlsx', appliedFilters)}
              disabled={isExporting || isLoading}
            >
              XLSX
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={() => void exportReport('activity', 'pdf', appliedFilters)}
              disabled={isExporting || isLoading}
            >
              PDF
            </Button>
          </div>
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

      {error ? (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-slate-600">Activity</th>
              <th className="px-3 py-2 text-right font-medium text-slate-600">Local Count</th>
              <th className="px-3 py-2 text-right font-medium text-slate-600">Foreign Count</th>
              <th className="px-3 py-2 text-right font-medium text-slate-600">Total Count</th>
              <th className="px-3 py-2 text-right font-medium text-slate-600">Local Total</th>
              <th className="px-3 py-2 text-right font-medium text-slate-600">Foreign Total</th>
              <th className="px-3 py-2 text-right font-medium text-slate-600">Grand Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {activity.map((row) => (
              <tr key={row.activity_id}>
                <td className="px-3 py-2 text-slate-800">{row.activity_name}</td>
                <td className="px-3 py-2 text-right text-slate-800">{row.local_count}</td>
                <td className="px-3 py-2 text-right text-slate-800">{row.foreign_count}</td>
                <td className="px-3 py-2 text-right text-slate-800">{row.total_count}</td>
                <td className="px-3 py-2 text-right text-slate-800">{row.local_total.toFixed(2)}</td>
                <td className="px-3 py-2 text-right text-slate-800">{row.foreign_total.toFixed(2)}</td>
                <td className="px-3 py-2 text-right font-semibold text-slate-900">
                  {row.total_amount.toFixed(2)}
                </td>
              </tr>
            ))}

            {!isLoading && activity.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                  No records found for selected filters.
                </td>
              </tr>
            ) : null}
          </tbody>
          {activity.length > 0 ? (
            <tfoot className="bg-slate-50 font-semibold text-slate-900 border-t-2 border-slate-300">
              <tr>
                <td className="px-3 py-2 text-left">Total</td>
                <td className="px-3 py-2 text-right">{totals.local_count}</td>
                <td className="px-3 py-2 text-right">{totals.foreign_count}</td>
                <td className="px-3 py-2 text-right">{totals.total_count}</td>
                <td className="px-3 py-2 text-right">{totals.local_total.toFixed(2)}</td>
                <td className="px-3 py-2 text-right">{totals.foreign_total.toFixed(2)}</td>
                <td className="px-3 py-2 text-right text-emerald-700">
                  {totals.total_amount.toFixed(2)}
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      <p className="mt-3 text-xs uppercase tracking-wide text-slate-500">
        {isLoading ? 'Loading report…' : `Total records: ${total}`}
      </p>
    </div>
  );
}
