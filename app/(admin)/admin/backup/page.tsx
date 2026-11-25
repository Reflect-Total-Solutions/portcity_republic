'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  FileJson,
  RefreshCw,
  Upload,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  BACKUP_APP_NAME,
  BACKUP_TABLES,
  type BackupPayload,
  type BackupTableName,
  type TableRestoreResult,
} from '@/lib/backup';

const TABLE_LABELS: Record<BackupTableName, string> = {
  users: 'Users',
  categories: 'Categories',
  activities: 'Activities',
  transaction_groups: 'Transaction Groups',
  transactions: 'Transactions',
  tokens: 'Tokens',
  audit_log: 'Audit Log',
  error_logs: 'Error Logs',
  printer_status_cache: 'Printer Status Cache',
};

function parseFilenameFromDisposition(disposition: string | null): string | null {
  if (!disposition) return null;
  const match = disposition.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? null;
}

export default function BackupPage() {
  const [counts, setCounts] = useState<Record<BackupTableName, number> | null>(null);
  const [isLoadingCounts, setIsLoadingCounts] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Restore state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [parsedBackup, setParsedBackup] = useState<BackupPayload | null>(null);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreResults, setRestoreResults] = useState<TableRestoreResult[] | null>(null);
  const [restoreWarnings, setRestoreWarnings] = useState<string[]>([]);
  const [restoreSuccess, setRestoreSuccess] = useState<string | null>(null);

  async function loadSummary() {
    setIsLoadingCounts(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/backup?mode=summary', {
        method: 'GET',
        cache: 'no-store',
      });
      const payload = (await response.json()) as {
        data?: { counts: Record<BackupTableName, number> };
        error?: string;
      };
      if (!response.ok || !payload.data) {
        setError(payload.error ?? 'Failed to load database summary');
        setCounts(null);
        return;
      }
      setCounts(payload.data.counts);
    } catch {
      setError('Failed to load database summary');
      setCounts(null);
    } finally {
      setIsLoadingCounts(false);
    }
  }

  useEffect(() => {
    void loadSummary();
  }, []);

  async function handleDownloadBackup(format: 'json' | 'sql') {
    setIsDownloading(true);
    setError(null);
    setDownloadMessage(null);

    try {
      const response = await fetch(`/api/admin/backup?format=${format}`, {
        method: 'GET',
        cache: 'no-store',
      });

      if (!response.ok) {
        const errPayload = (await response.json().catch(() => ({}))) as { error?: string };
        setError(errPayload.error ?? `Failed to download ${format.toUpperCase()} backup`);
        return;
      }

      const blob = await response.blob();
      const filename =
        parseFilenameFromDisposition(response.headers.get('content-disposition')) ??
        `portcity-backup-${new Date().toISOString().slice(0, 10)}.${format}`;

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      setDownloadMessage(`Backup downloaded: ${filename}`);
    } catch {
      setError('Failed to download backup file. Please check your connection.');
    } finally {
      setIsDownloading(false);
    }
  }

  async function handleDownloadBoth() {
    await handleDownloadBackup('json');
    await handleDownloadBackup('sql');
    setDownloadMessage('Downloaded both JSON and SQL backup files.');
  }

  async function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setError(null);
    setRestoreResults(null);
    setRestoreWarnings([]);
    setRestoreSuccess(null);
    setConfirmChecked(false);

    if (!file) {
      setSelectedFileName(null);
      setParsedBackup(null);
      return;
    }

    try {
      const text = await file.text();
      const json = JSON.parse(text) as Partial<BackupPayload>;

      if (json.app !== BACKUP_APP_NAME || !json.tables || typeof json.tables !== 'object') {
        setError('Invalid backup file. Please select a valid Port City Republic JSON backup.');
        setSelectedFileName(null);
        setParsedBackup(null);
        return;
      }

      setSelectedFileName(file.name);
      setParsedBackup(json as BackupPayload);
    } catch {
      setError('Could not read the selected file. Make sure it is a valid .json backup file.');
      setSelectedFileName(null);
      setParsedBackup(null);
    }
  }

  async function handleRestoreBackup() {
    if (!parsedBackup || !confirmChecked) return;

    setIsRestoring(true);
    setError(null);
    setRestoreResults(null);
    setRestoreWarnings([]);
    setRestoreSuccess(null);

    try {
      const response = await fetch('/api/admin/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsedBackup),
      });

      const payload = (await response.json()) as {
        success?: boolean;
        data?: {
          results: TableRestoreResult[];
          warnings: string[];
          restored_at: string;
        };
        error?: string;
      };

      if (payload.data) {
        setRestoreResults(payload.data.results);
        setRestoreWarnings(payload.data.warnings ?? []);
      }

      if (!response.ok || !payload.success) {
        setError(payload.error ?? 'Backup restore completed with errors. See table details below.');
      } else {
        setRestoreSuccess('All backup data has been restored and updated in Supabase.');
        setConfirmChecked(false);
      }

      await loadSummary();
    } catch {
      setError('Failed to upload and restore backup.');
    } finally {
      setIsRestoring(false);
    }
  }

  const totalLiveRows = counts
    ? BACKUP_TABLES.reduce((sum, table) => sum + (counts[table] ?? 0), 0)
    : 0;

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1200px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      {/* Header */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">
              Data Management
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-900">
              Database Backup &amp; Restore
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Manually download a full backup of all Supabase data, or upload a saved backup file to
              restore and update Supabase.
            </p>
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={() => void loadSummary()}
            disabled={isLoadingCounts}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${isLoadingCounts ? 'animate-spin' : ''}`} />
            Refresh Counts
          </Button>
        </div>

        {error ? (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {downloadMessage ? (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{downloadMessage}</span>
          </div>
        ) : null}

        {restoreSuccess ? (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{restoreSuccess}</span>
          </div>
        ) : null}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Card 1: Manual Download Backup */}
        <section className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white">
                <Database className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">1. Download Backup</h2>
                <p className="text-xs text-slate-500">
                  Exports all tables from Supabase into a single .json file
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
              <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
                <span>Live Supabase Tables</span>
                <span>Total: {isLoadingCounts ? '...' : totalLiveRows.toLocaleString()} rows</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {BACKUP_TABLES.map((table) => (
                  <div
                    key={table}
                    className="flex items-center justify-between rounded-lg bg-white px-2.5 py-1.5 border border-slate-100"
                  >
                    <span className="text-slate-600 truncate">{TABLE_LABELS[table]}</span>
                    <span className="font-semibold text-slate-900">
                      {isLoadingCounts ? '-' : (counts?.[table] ?? 0).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-5 space-y-2.5">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => void handleDownloadBackup('json')}
                disabled={isDownloading}
              >
                <Download className="mr-2 h-4 w-4" />
                {isDownloading ? 'Preparing...' : 'Download JSON (.json)'}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => void handleDownloadBackup('sql')}
                disabled={isDownloading}
              >
                <Download className="mr-2 h-4 w-4" />
                {isDownloading ? 'Preparing...' : 'Download SQL (.sql)'}
              </Button>
            </div>
            <Button
              type="button"
              className="w-full"
              onClick={() => void handleDownloadBoth()}
              disabled={isDownloading}
            >
              <Download className="mr-2 h-4 w-4" />
              {isDownloading ? 'Preparing Backup Files...' : 'Download Both (JSON + SQL)'}
            </Button>
          </div>
        </section>

        {/* Card 2: Upload & Restore to Supabase */}
        <section className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white">
                <Upload className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">2. Upload &amp; Restore</h2>
                <p className="text-xs text-slate-500">
                  Upload a downloaded backup file to update all data in Supabase
                </p>
              </div>
            </div>

            <div className="mt-4">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={(e) => void handleFileSelect(e)}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center transition hover:border-slate-400 hover:bg-slate-100"
              >
                <FileJson className="h-8 w-8 text-slate-400" />
                <span className="mt-2 text-sm font-medium text-slate-700">
                  {selectedFileName ?? 'Click to select a .json backup file'}
                </span>
                <span className="mt-1 text-xs text-slate-500">
                  Only files downloaded from Port City Republic backup are supported
                </span>
              </button>
            </div>

            {parsedBackup ? (
              <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                <div className="text-xs text-slate-600 space-y-1">
                  <p>
                    <span className="font-semibold text-slate-800">Backup Date:</span>{' '}
                    {new Date(parsedBackup.created_at).toLocaleString()}
                  </p>
                  {parsedBackup.created_by ? (
                    <p>
                      <span className="font-semibold text-slate-800">Created By:</span>{' '}
                      {parsedBackup.created_by}
                    </p>
                  ) : null}
                </div>

                <div className="grid grid-cols-2 gap-1.5 text-xs">
                  {BACKUP_TABLES.map((table) => (
                    <div
                      key={table}
                      className="flex items-center justify-between rounded bg-white px-2 py-1 border border-slate-100"
                    >
                      <span className="text-slate-600">{TABLE_LABELS[table]}</span>
                      <span className="font-semibold text-slate-900">
                        {(parsedBackup.tables[table]?.length ?? 0).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>

                <label className="flex items-start gap-2 pt-1 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmChecked}
                    onChange={(e) => setConfirmChecked(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300"
                  />
                  <span>
                    I confirm that I want to upload and upsert these records into Supabase. Existing
                    records with matching IDs will be updated.
                  </span>
                </label>
              </div>
            ) : null}
          </div>

          <div className="mt-5">
            <Button
              type="button"
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => void handleRestoreBackup()}
              disabled={!parsedBackup || !confirmChecked || isRestoring}
            >
              <Upload className="mr-2 h-4 w-4" />
              {isRestoring ? 'Uploading & Restoring to Supabase...' : 'Restore Backup to Supabase'}
            </Button>
          </div>
        </section>
      </div>

      {/* Restore Results */}
      {restoreResults ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Restore Results</h2>

          {restoreWarnings.length > 0 ? (
            <div className="mt-3 space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              {restoreWarnings.map((warning, idx) => (
                <p key={idx} className="flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{warning}</span>
                </p>
              ))}
            </div>
          ) : null}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <th className="py-2 pr-4">Table</th>
                  <th className="py-2 pr-4">In File</th>
                  <th className="py-2 pr-4">Restored / Updated</th>
                  <th className="py-2 pr-4">Skipped</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {restoreResults.map((row) => (
                  <tr key={row.table}>
                    <td className="py-2 pr-4 font-medium text-slate-800">
                      {TABLE_LABELS[row.table]}
                    </td>
                    <td className="py-2 pr-4 text-slate-600">{row.total.toLocaleString()}</td>
                    <td className="py-2 pr-4 font-semibold text-emerald-700">
                      {row.restored.toLocaleString()}
                    </td>
                    <td className="py-2 pr-4 text-slate-600">{row.skipped.toLocaleString()}</td>
                    <td className="py-2">
                      {row.error ? (
                        <span className="text-xs font-medium text-red-600">{row.error}</span>
                      ) : (
                        <span className="text-xs font-medium text-emerald-600">Success</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </main>
  );
}
