'use client';

import { useMemo, useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { TIMEZONE_COLOMBO } from '@/lib/constants';
import type { Activity } from '@/types/activity';
import type { Transaction } from '@/types/transaction';

export type TodayTicketItem = Transaction & {
  token_number?: string | null;
  exchanged_to_transaction_id?: string | null;
  exchanged_from_transaction_id?: string | null;
  is_exchanged?: boolean;
};

type TodayTicketsModalProps = {
  open: boolean;
  onClose: () => void;
  activitiesById: Map<string, Activity>;
  onSelectTicketToExchange: (transactionId: string) => void;
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-LK', {
    style: 'currency',
    currency: 'LKR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatTime(timestamp: string): string {
  return new Intl.DateTimeFormat('en-LK', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: TIMEZONE_COLOMBO,
  }).format(new Date(timestamp));
}

export default function TodayTicketsModal({
  open,
  onClose,
  activitiesById,
  onSelectTicketToExchange,
}: TodayTicketsModalProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [tickets, setTickets] = useState<TodayTicketItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load today's tickets whenever modal opens
  useEffect(() => {
    if (!open) {
      setSearchTerm('');
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setError(null);

    // Compute Colombo today boundaries in local format (YYYY-MM-DD)
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIMEZONE_COLOMBO,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const todayDateStr = formatter.format(now); // e.g. "2026-10-12"

    // Fetch transactions with start_date set to today's start
    // Using start_date with limit=1000 so all today's tickets are retrieved
    const startIso = `${todayDateStr}T00:00:00+05:30`;
    const endIso = `${todayDateStr}T23:59:59.999+05:30`;

    fetch(`/api/transactions?start_date=${encodeURIComponent(startIso)}&end_date=${encodeURIComponent(endIso)}&limit=1000&include_cancelled=false`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error('Failed to load tickets for today');
        }
        return res.json();
      })
      .then((payload) => {
        if (isMounted) {
          const list: TodayTicketItem[] = payload.data ?? [];
          // Filter to only tickets bought on that particular date that are currently exchangeable:
          // Active (not cancelled and not exchanged away)
          const exchangeable = list.filter(
            (t) => !t.cancelled_at && !t.exchanged_to_transaction_id
          );
          setTickets(exchangeable);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err.message || 'Error loading tickets');
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [open]);

  // Real-time search filter by token number
  const filteredTickets = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return tickets;
    return tickets.filter((t) => {
      const token = t.token_number ? t.token_number.toLowerCase() : '';
      return token.includes(term);
    });
  }, [tickets, searchTerm]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div className="relative flex flex-col max-h-[90vh] w-full max-w-3xl rounded-2xl bg-white shadow-2xl border-2 border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-3 w-3 rounded-full bg-blue-600 animate-pulse" />
              <h2 className="text-xl font-bold text-slate-900">Exchange Tickets — Today&apos;s Tickets</h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-600">
              Only tickets purchased today are shown. Search in real time by token number to exchange game.
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition-colors"
            onClick={onClose}
          >
            <span className="sr-only">Close</span>
            ✕
          </button>
        </div>

        {/* Real-time Search Box */}
        <div className="border-b border-slate-200 bg-white p-4">
          <div className="relative">
            <input
              type="text"
              autoFocus
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="🔍 Real-time search by Token Number (e.g. 20261012-001)..."
              className="w-full rounded-xl border-2 border-slate-300 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md bg-slate-200 px-2 py-0.5 text-xs font-bold text-slate-600 hover:bg-slate-300"
              >
                Clear
              </button>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
            <span>
              Showing <strong className="text-slate-800">{filteredTickets.length}</strong> of{' '}
              <strong className="text-slate-800">{tickets.length}</strong> active tickets today
            </span>
            {searchTerm && (
              <span className="font-medium text-blue-600">Filtering in real time</span>
            )}
          </div>
        </div>

        {/* Tickets List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-500">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent mb-3" />
              <p className="text-sm font-semibold">Loading today&apos;s tickets...</p>
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center text-sm font-semibold text-red-600">
              {error}
            </div>
          ) : filteredTickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-500 text-center">
              <div className="mb-2 text-3xl">🎫</div>
              <p className="text-base font-bold text-slate-800">
                {searchTerm ? 'No matching ticket found' : 'No active tickets found for today'}
              </p>
              <p className="text-xs text-slate-500 max-w-sm mt-1">
                {searchTerm
                  ? `No ticket matching token "${searchTerm}" was bought today.`
                  : 'Tickets bought today that are eligible for game exchange will appear here.'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              {filteredTickets.map((ticket) => {
                const activity = activitiesById.get(ticket.activity_id);
                const activityName = activity?.name ?? 'Unknown Activity';

                return (
                  <div
                    key={ticket.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 hover:bg-blue-50/50 transition-colors"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white font-black text-sm shadow-sm">
                        {ticket.token_index ?? 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm font-bold text-blue-900 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md">
                            {ticket.token_number ?? 'No Token'}
                          </span>
                          <span className="text-xs font-semibold uppercase text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                            {ticket.price_type}
                          </span>
                          {ticket.exchanged_from_transaction_id && (
                            <span className="text-[10px] font-bold uppercase text-purple-700 bg-purple-100 px-1.5 py-0.5 rounded border border-purple-200">
                              Exchanged Before
                            </span>
                          )}
                        </div>
                        <p className="mt-1 font-bold text-slate-900 truncate text-base">
                          {activityName}
                        </p>
                        <p className="text-xs text-slate-500">
                          Ref: <span className="font-mono">{ticket.txn_reference}</span> • Purchased at {formatTime(ticket.created_at)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                      <div className="text-left sm:text-right">
                        <div className="text-base font-bold text-slate-900">
                          {formatCurrency(ticket.amount)}
                        </div>
                      </div>

                      <Button
                        type="button"
                        onClick={() => {
                          onSelectTicketToExchange(ticket.id);
                        }}
                        className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-xl shadow-sm text-xs"
                      >
                        Exchange Game
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-3.5">
          <p className="text-xs text-slate-500">
            Tickets can be exchanged multiple times. The original token number stays the same.
          </p>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
