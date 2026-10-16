'use client';

import { useCallback, useState } from 'react';

import type { ActivityReportRow } from '@/types/report';

export type VendorReportFilters = {
  from?: string;
  to?: string;
  startTime?: string;
  endTime?: string;
};

type ListResponse<T> = {
  data?: T[];
  total?: number;
  error?: string;
};

type MutationResult = {
  success: boolean;
  error?: string;
};

function buildQueryString(filters: VendorReportFilters): string {
  const params = new URLSearchParams();

  if (filters.from) {
    params.set('from', filters.from);
  }

  if (filters.to) {
    params.set('to', filters.to);
  }

  if (filters.startTime) {
    params.set('start_time', filters.startTime);
  }

  if (filters.endTime) {
    params.set('end_time', filters.endTime);
  }

  const queryString = params.toString();
  return queryString ? `?${queryString}` : '';
}

function parseFilenameFromDisposition(disposition: string | null): string | null {
  if (!disposition) {
    return null;
  }
  const match = disposition.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? null;
}

export function useVendorReports() {
  const [activity, setActivity] = useState<ActivityReportRow[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadActivityReport = useCallback(async (filters: VendorReportFilters = {}): Promise<MutationResult> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/vendor/reports/activity${buildQueryString(filters)}`, {
        method: 'GET',
        cache: 'no-store',
      });

      const payload = (await response.json()) as ListResponse<ActivityReportRow>;

      if (!response.ok) {
        setActivity([]);
        setTotal(0);
        setError(payload.error ?? 'Unable to load activity report');
        return { success: false, error: payload.error ?? 'Unable to load activity report' };
      }

      setActivity(payload.data ?? []);
      setTotal(payload.total ?? (payload.data ?? []).length);
      return { success: true };
    } catch {
      setActivity([]);
      setTotal(0);
      setError('Unable to load activity report');
      return { success: false, error: 'Unable to load activity report' };
    } finally {
      setIsLoading(false);
    }
  }, []);

  const exportReport = useCallback(
    async (format: 'xlsx' | 'pdf', filters: VendorReportFilters = {}): Promise<MutationResult> => {
      setIsExporting(true);
      setError(null);

      try {
        const queryParams = new URLSearchParams(buildQueryString(filters));
        queryParams.set('format', format);

        const response = await fetch(`/api/vendor/reports/export?${queryParams.toString()}`, {
          method: 'GET',
        });

        if (!response.ok) {
          try {
            const errorPayload = (await response.json()) as { error?: string };
            setError(errorPayload.error ?? 'Failed to export report');
            return { success: false, error: errorPayload.error ?? 'Failed to export report' };
          } catch {
            setError('Failed to export report');
            return { success: false, error: 'Failed to export report' };
          }
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');

        const disposition = response.headers.get('Content-Disposition');
        const filename = parseFilenameFromDisposition(disposition);

        a.href = url;
        a.download = filename ?? `vendor-report-${new Date().toISOString()}.${format}`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        return { success: true };
      } catch {
        setError('Failed to generate export file. Please check your connection and try again.');
        return { success: false, error: 'Failed to generate export file' };
      } finally {
        setIsExporting(false);
      }
    },
    []
  );

  return {
    activity,
    total,
    isLoading,
    isExporting,
    error,
    loadActivityReport,
    exportReport,
  };
}