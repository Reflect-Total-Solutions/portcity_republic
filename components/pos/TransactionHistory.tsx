'use client';

import { Button } from '@/components/ui/button';
import { TIMEZONE_COLOMBO } from '@/lib/constants';
import type { Activity } from '@/types/activity';
import type { Transaction } from '@/types/transaction';

type TransactionHistoryItem = Transaction & {
  token_number?: string | null;
  exchanged_to_transaction_id?: string | null;
  exchanged_from_transaction_id?: string | null;
  is_exchanged?: boolean;
};

type TransactionHistoryProps = {
  transactions: TransactionHistoryItem[];
  activitiesById: Map<string, Activity>;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onCancelTransaction: (transactionId: string) => void;
  onExchangeTransaction?: (transactionId: string) => void;
  onReprintTransaction?: (transactionId: string) => void;
  onReprintGroup?: (groupId: string) => void;
  cancellingTransactionId?: string | null;
  isLoading?: boolean;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
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

export default function TransactionHistory({
  transactions,
  activitiesById,
  searchQuery,
  onSearchQueryChange,
  onCancelTransaction,
  onExchangeTransaction,
  onReprintTransaction,
  onReprintGroup,
  cancellingTransactionId = null,
  isLoading = false,
  onLoadMore,
  hasMore = false,
  isLoadingMore = false,
}: TransactionHistoryProps) {
  return (
    <section className="rounded-2xl border-2 border-slate-300 bg-white p-5 shadow-md">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Transaction History</h2>
          <p className="text-sm text-slate-600">Search by token, activity, or reference</p>
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder="Search token or reference"
          className="h-12 w-full rounded-xl border-2 border-slate-300 px-4 text-base outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-200 sm:w-80"
        />
      </div>

      <div className="mt-5 max-h-96 overflow-y-auto rounded-2xl border-2 border-slate-300 shadow-md">
        <table className="w-full divide-y divide-slate-300 text-sm">
          <thead className="sticky top-0 bg-slate-900 text-xs font-bold uppercase tracking-wider text-white">
            <tr>
              <th className="px-4 py-3 text-left">Group</th>
              <th className="px-4 py-3 text-left">Token</th>
              <th className="px-4 py-3 text-left">Activity</th>
              <th className="px-4 py-3 text-left">Amount</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Time</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white">
            {isLoading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-600 font-semibold">
                  Loading transactions...
                </td>
              </tr>
            ) : transactions.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-600 font-semibold">
                  No transactions found
                </td>
              </tr>
            ) : (
              transactions.map((transaction) => {
                const activity = activitiesById.get(transaction.activity_id);

                return (
                  <tr key={transaction.id} className="hover:bg-slate-100 transition-colors">
                    <td className="px-4 py-3 font-semibold text-slate-600 text-xs">
                      {transaction.transaction_group_id.slice(0, 8)}...
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-900 text-base">
                      {transaction.token_number ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-slate-800 font-semibold">
                      {activity?.name ?? transaction.activity_id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3 text-slate-900 font-bold text-base">{formatCurrency(transaction.amount)}</td>
                    <td className="px-4 py-3">
                      {transaction.cancelled_at ? (
                        transaction.exchanged_to_transaction_id ? (
                          <span className="rounded-lg border-2 border-purple-400 bg-purple-50 px-3 py-1 text-xs font-bold text-purple-900 uppercase tracking-wider">
                            Exchanged
                          </span>
                        ) : (
                          <span className="rounded-lg border-2 border-amber-400 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-900 uppercase tracking-wider">
                            Cancelled
                          </span>
                        )
                      ) : (
                        <span className="rounded-lg border-2 border-green-400 bg-green-50 px-3 py-1 text-xs font-bold text-green-900 uppercase tracking-wider">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-700 font-semibold">{formatTime(transaction.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5 flex-wrap">
                        {onExchangeTransaction && !transaction.cancelled_at && !transaction.exchanged_to_transaction_id && (
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            className="bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-800 border-blue-200"
                            disabled={cancellingTransactionId === transaction.id}
                            onClick={() => onExchangeTransaction(transaction.id)}
                          >
                            Exchange
                          </Button>
                        )}
                        {/* {onReprintGroup && !transaction.cancelled_at && (
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            onClick={() => onReprintGroup(transaction.transaction_group_id)}
                          >
                            Reprint Group
                          </Button>
                        )}
                        {onReprintTransaction && !transaction.cancelled_at && (
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            onClick={() => onReprintTransaction(transaction.id)}
                          >
                            Reprint
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          disabled={Boolean(transaction.cancelled_at) || cancellingTransactionId === transaction.id}
                          onClick={() => onCancelTransaction(transaction.id)}
                        >
                          {cancellingTransactionId === transaction.id ? 'Cancelling...' : 'Cancel'}
                        </Button> */}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {onLoadMore && hasMore && !isLoading ? (
        <div className="mt-4 flex justify-center">
          <Button
            type="button"
            variant="outline"
            className="h-11 px-6 font-semibold"
            disabled={isLoadingMore}
            onClick={onLoadMore}
          >
            {isLoadingMore ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
