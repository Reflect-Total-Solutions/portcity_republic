'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

import ActivityGrid from '@/components/pos/ActivityGrid';
import DailySummary from '@/components/pos/DailySummary';
import PaymentConfirmation from '@/components/pos/PaymentConfirmation';
import PricingToggle from '@/components/pos/PricingToggle';
import TicketPreview, { type PrintedTicket } from '@/components/pos/TicketPreview';
import TransactionHistory from '@/components/pos/TransactionHistory';
import { Button } from '@/components/ui/button';
import { useActivities } from '@/hooks/useActivities';
import { useAuth } from '@/hooks/useAuth';
import { usePosSummary } from '@/hooks/usePosSummary';
import { useTransactions } from '@/hooks/useTransactions';
import { useNotificationsStore } from '@/stores/notifications';
import { usePriceModeStore } from '@/stores/priceMode';
import type { Activity } from '@/types/activity';
import { EXCHANGE_SPLIT_TEMPLATES, type ExchangeSplitOption } from '@/lib/constants';
import { getColomboStartOfDay, getColomboEndOfDay } from '@/lib/dateUtils';

type CartItem = {
  activity: Activity;
  quantity: number;
  priceType: 'local' | 'foreign';
};

type ExchangedTransaction = {
  id: string;
  activity_id: string;
  price_type: 'local' | 'foreign';
  amount: number;
  token_number?: string | null;
  token_index?: number | null;
  token_total?: number | null;
  created_at: string;
  txn_reference: string;
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-LK', {
    style: 'currency',
    currency: 'LKR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export default function DashboardPage() {
  const { user } = useAuth();

  const {
    activities,
    categories,
    isLoading: isActivitiesLoading,
    error: activitiesError,
    refetch: refetchActivities,
  } = useActivities({
    limit: 100,
  });

  const today = new Date();
  const startOfTodayISO = getColomboStartOfDay(today).toISOString();
  const endOfTodayISO = getColomboEndOfDay(today).toISOString();

  const {
    transactions,
    summary,
    isLoading: isTransactionsLoading,
    isMutating: isTransactionsMutating,
    isLoadingMore,
    hasMore,
    refetch: refetchTransactions,
    loadMore,
    createBulkTransactions,
    cancelTransaction,
    searchTransactions,
  } = useTransactions({
    limit: 50,
    startDate: startOfTodayISO,
    endDate: endOfTodayISO,
    skipCount: true,
  });

  // Gross total / Daily Summary is computed server-side (get_pos_daily_summary)
  // rather than by summing the full day's rows in the browser.
  const {
    summary: dailySummary,
    refetch: refetchSummary,
  } = usePosSummary({
    startDate: startOfTodayISO,
    endDate: endOfTodayISO,
  });

  const priceType = usePriceModeStore((state) => state.priceType);
  const setPriceType = usePriceModeStore((state) => state.setPriceType);

  const notifications = useNotificationsStore((state) => state.items);
  const pushNotification = useNotificationsStore((state) => state.push);
  const removeNotification = useNotificationsStore((state) => state.remove);

  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isConfirmingPayment, setIsConfirmingPayment] = useState(false);
  const [previewTickets, setPreviewTickets] = useState<PrintedTicket[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [cancellingTransactionId, setCancellingTransactionId] = useState<string | null>(null);

  // One key per checkout attempt set: reused on retry of the same cart so the
  // server can deduplicate, regenerated whenever the cart changes.
  const idempotencyKeyRef = useRef<string | null>(null);

  // Exchange state
  const [exchangeTxnId, setExchangeTxnId] = useState<string | null>(null);
  const [exchangeTargetActivityId, setExchangeTargetActivityId] = useState<string | null>(null);
  const [exchangeMode, setExchangeMode] = useState<'swap' | ExchangeSplitOption>('swap');
  const [splitActivityIds, setSplitActivityIds] = useState<(string | null)[]>([]);
  const [isExchanging, setIsExchanging] = useState(false);

  useEffect(() => {
    const timers = notifications
      .filter((item) => item.durationMs !== 0)
      .map((item) => {
        const timeoutMs = item.durationMs ?? 4000;
        return setTimeout(() => {
          removeNotification(item.id);
        }, timeoutMs);
      });

    return () => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
    };
  }, [notifications, removeNotification]);

  // Tracks whether the search effect has run once. The initial page load is
  // already handled by useTransactions' autoFetch, so we must not refetch it
  // again here (that caused a duplicate /api/transactions request on mount).
  const searchInitialisedRef = useRef(false);

  useEffect(() => {
    const trimmed = searchQuery.trim();
    const debounceId = setTimeout(() => {
      if (trimmed.length >= 2) {
        void searchTransactions({
          q: trimmed,
          limit: 100,
        });
      } else if (searchInitialisedRef.current) {
        // Only refetch when the user actively clears/edits the search box,
        // never on the first mount.
        void refetchTransactions();
      }

      searchInitialisedRef.current = true;
    }, 350);

    return () => clearTimeout(debounceId);
  }, [refetchTransactions, searchQuery, searchTransactions]);

  const filteredActivities = useMemo(() => {
    const sorted = [...activities].sort((a, b) => {
      if (a.display_order !== b.display_order) {
        return a.display_order - b.display_order;
      }

      return a.name.localeCompare(b.name);
    });

    if (selectedCategoryId === 'all') {
      return sorted;
    }

    return sorted.filter((activity) => activity.category_id === selectedCategoryId);
  }, [activities, selectedCategoryId]);

  const activityById = useMemo(() => {
    return new Map(activities.map((activity) => [activity.id, activity] as const));
  }, [activities]);

  const cartSummary = useMemo(() => {
    return cartItems.reduce(
      (acc, item) => {
        const unitPrice = item.priceType === 'local' ? item.activity.local_price : item.activity.foreign_price;
        const quantity = Math.max(1, item.quantity);

        return {
          uniqueActivities: acc.uniqueActivities + 1,
          totalTickets: acc.totalTickets + quantity,
          totalAmount: acc.totalAmount + unitPrice * quantity,
        };
      },
      {
        uniqueActivities: 0,
        totalTickets: 0,
        totalAmount: 0,
      }
    );
  }, [cartItems]);

  function addActivityToCart(activity: Activity) {
    idempotencyKeyRef.current = null;
    setCartItems((current) => {
      const existingIndex = current.findIndex(
        (item) => item.activity.id === activity.id && item.priceType === priceType
      );

      if (existingIndex === -1) {
        return [...current, { activity, quantity: 1, priceType }];
      }

      return current.map((item, index) =>
        index === existingIndex
          ? {
              ...item,
              quantity: item.quantity + 1,
            }
          : item
      );
    });
  }

  function updateCartQuantity(activityId: string, pType: 'local' | 'foreign', quantity: number) {
    idempotencyKeyRef.current = null;
    setCartItems((current) =>
      current.map((item) =>
        item.activity.id === activityId && item.priceType === pType
          ? {
              ...item,
              quantity: Math.max(1, Math.floor(quantity || 1)),
            }
          : item
      )
    );
  }

  function removeFromCart(activityId: string, pType: 'local' | 'foreign') {
    idempotencyKeyRef.current = null;
    setCartItems((current) => current.filter((item) => !(item.activity.id === activityId && item.priceType === pType)));
  }

  function clearCart() {
    idempotencyKeyRef.current = null;
    setCartItems([]);
  }

  async function handleConfirmPayment(paymentMethod: 'cash' | 'card') {
    if (cartItems.length === 0) {
      return;
    }

    setPaymentError(null);
    setIsConfirmingPayment(true);

    try {
      // Build the items array for the bulk API
      const bulkItems = cartItems.map((item) => ({
        activity_id: item.activity.id,
        quantity: Math.max(1, item.quantity),
        price_type: item.priceType,
      }));

      // Reuse the key when retrying the same unchanged cart so the server can
      // recognize the retry and never double-insert.
      if (!idempotencyKeyRef.current) {
        idempotencyKeyRef.current = crypto.randomUUID();
      }

      // Single atomic API call to create all transactions
      const bulkResult = await createBulkTransactions(
        bulkItems,
        paymentMethod,
        idempotencyKeyRef.current
      );

      if (!bulkResult.success || !bulkResult.data) {
        setPaymentError(bulkResult.error ?? 'Unable to create transactions.');
        setIsConfirmingPayment(false);
        return;
      }

      const createdTransactions = bulkResult.data.transactions;
      const totalCreated = createdTransactions.length;

      // === Close the dialog and clear cart IMMEDIATELY ===
      clearCart();
      setPaymentError(null);
      setIsConfirmingPayment(false);
      setIsPaymentOpen(false);

      pushNotification({
        type: 'success',
        title: 'Payment complete',
        message: `${totalCreated} ticket(s) created successfully. Showing preview...`,
      });

      // Refresh transaction list + daily summary right away
      void refetchTransactions();
      void refetchSummary();

      // === Show generated tickets preview in the browser (temp) ===
      const ticketsToPreview: PrintedTicket[] = createdTransactions.map((t) => {
        const matchingCartItem = cartItems.find((c) => c.activity.id === t.activity_id && c.priceType === t.price_type);
        const fallbackName = activities.find((a) => a.id === t.activity_id)?.name ?? 'Unknown Activity';
        
        return {
          id: t.id,
          token_number: t.token_number,
          token_index: t.token_index,
          token_total: t.token_total,
          price_type: t.price_type,
          amount: t.amount,
          activityName: matchingCartItem?.activity.name ?? fallbackName,
          cashierName: user?.display_name ?? 'Staff',
          created_at: t.created_at,
          txn_reference: t.txn_reference,
        };
      });
      
      setPreviewTickets(ticketsToPreview);
    } catch {
      setPaymentError('Unexpected error while processing payment. Please try again.');
      setIsConfirmingPayment(false);
    }
  }

  async function handleCancelTransaction(transactionId: string) {
    setCancellingTransactionId(transactionId);

    const cancelCode = window.prompt('Enter cancellation code:');
    if (!cancelCode) {
      setCancellingTransactionId(null);
      return;
    }

    const reason = window.prompt('Cancellation reason (optional):', '') ?? undefined;
    const result = await cancelTransaction(transactionId, reason, cancelCode);

    if (!result.success) {
      pushNotification({
        type: 'error',
        title: 'Unable to cancel transaction',
        message: result.error,
      });
    } else {
      pushNotification({
        type: 'info',
        title: 'Transaction cancelled',
        message: 'Transaction was marked as cancelled.',
      });
      void refetchSummary();
    }

    setCancellingTransactionId(null);
  }

  function handleOpenExchangeModal(transactionId: string) {
    setExchangeTxnId(transactionId);
    setExchangeTargetActivityId(null);
    setExchangeMode('swap');
    setSplitActivityIds([]);
  }

  function handleCloseExchangeModal() {
    setExchangeTxnId(null);
    setExchangeTargetActivityId(null);
    setExchangeMode('swap');
    setSplitActivityIds([]);
  }

  function handleSelectExchangeMode(mode: 'swap' | ExchangeSplitOption) {
    setExchangeMode(mode);
    if (mode === 'swap') {
      setSplitActivityIds([]);
    } else {
      setExchangeTargetActivityId(null);
      setSplitActivityIds(
        Array<string | null>(EXCHANGE_SPLIT_TEMPLATES[mode].denominations.length).fill(null)
      );
    }
  }

  async function handleConfirmExchange() {
    if (!exchangeTxnId) return;

    const isSplit = exchangeMode !== 'swap';
    if (isSplit) {
      if (splitActivityIds.length === 0 || splitActivityIds.some((id) => !id)) return;
    } else if (!exchangeTargetActivityId) {
      return;
    }

    setIsExchanging(true);

    try {
      const response = await fetch(`/api/transactions/${exchangeTxnId}/exchange`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          isSplit
            ? { split: { option: exchangeMode, activity_ids: splitActivityIds } }
            : { activity_id: exchangeTargetActivityId }
        ),
      });

      const result = await response.json();

      if (!response.ok) {
        pushNotification({
          type: 'error',
          title: 'Exchange failed',
          message: result.error || 'Failed to exchange ticket.',
        });
      } else {
        const newTxns: ExchangedTransaction[] = isSplit
          ? result.new_transactions
          : [result.new_transaction];

        pushNotification({
          type: 'success',
          title: 'Ticket Exchanged',
          message: isSplit
            ? `The ticket was exchanged for ${newTxns.length} new tickets.`
            : 'The ticket was successfully exchanged.',
        });

        setPreviewTickets(newTxns.map((t) => ({
          id: t.id,
          token_number: t.token_number,
          token_index: t.token_index,
          token_total: t.token_total,
          price_type: t.price_type,
          amount: t.amount,
          activityName: activities.find((a) => a.id === t.activity_id)?.name ?? 'Unknown Activity',
          cashierName: user?.display_name ?? 'Staff',
          created_at: t.created_at,
          txn_reference: t.txn_reference,
        })));

        handleCloseExchangeModal();
        void refetchTransactions();
        void refetchSummary();
      }
    } catch (error) {
      pushNotification({
        type: 'error',
        title: 'Exchange request error',
        message: 'Something went wrong while requesting exchange.',
      });
    } finally {
      setIsExchanging(false);
    }
  }

  return (
    <>
      <main className="mx-auto min-h-screen w-full max-w-[1600px] px-4 py-4 sm:px-6 lg:px-8">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-600">
            Port City Republic
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900 sm:text-3xl">
            POS Dashboard
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Select activities, adjust quantities, then confirm payment
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/logout"
            className="inline-flex h-11 items-center justify-center rounded-lg border-2 border-slate-400 px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100"
          >
            Sign out
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_400px]">
        <section className="rounded-2xl border-2 border-slate-300 bg-white p-5 shadow-md">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <PricingToggle
              value={priceType}
              onChange={setPriceType}
              disabled={isTransactionsMutating}
            />

            <div className="flex flex-wrap gap-2 overflow-x-auto pb-2">
              <button
                type="button"
                className={`rounded-lg border-2 px-3 py-2 text-xs font-bold uppercase tracking-wide transition-colors shrink-0 ${
                  selectedCategoryId === 'all'
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                }`}
                onClick={() => setSelectedCategoryId('all')}
              >
                All
              </button>

              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className={`rounded-lg border-2 px-3 py-2 text-xs font-bold uppercase tracking-wide transition-colors shrink-0 ${
                    selectedCategoryId === category.id
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                  }`}
                  onClick={() => setSelectedCategoryId(category.id)}
                >
                  {category.name}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5">
            <ActivityGrid
              activities={filteredActivities}
              isLoading={isActivitiesLoading}
              error={activitiesError}
              onRetry={refetchActivities}
              onActivitySelect={(activity) => {
                addActivityToCart(activity);
                setPaymentError(null);
              }}
            />
          </div>
        </section>

        <div className="flex flex-col gap-4 lg:sticky lg:top-4 lg:h-fit">
          <div className="rounded-2xl border-3 border-emerald-400 bg-gradient-to-br from-white to-emerald-50 p-5 shadow-lg">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Shopping Cart</h2>
                <p className="text-xs text-slate-600">
                  {cartSummary.uniqueActivities} item(s) • {cartSummary.totalTickets} ticket(s)
                </p>
              </div>
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center rounded-lg border-2 border-red-400 bg-red-50 px-3 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-50"
                disabled={cartItems.length === 0 || isConfirmingPayment || isTransactionsMutating}
                onClick={clearCart}
              >
                Clear
              </button>
            </div>

            <div className="max-h-80 space-y-2 overflow-y-auto rounded-xl bg-white p-3 border-2 border-slate-300">
              {cartItems.map((item) => {
                const unitPrice = item.priceType === 'local' ? item.activity.local_price : item.activity.foreign_price;
                
                return (
                  <div key={`${item.activity.id}-${item.priceType}`} className="rounded-lg border-2 border-slate-300 bg-gradient-to-r from-slate-50 to-white p-3 hover:from-blue-50 transition-colors">
                    <div className="flex items-start gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-900 line-clamp-2">{item.activity.name}</p>
                        <span className="mt-1 inline-block rounded-lg bg-slate-200 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-700 border border-slate-300">
                          {item.priceType}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-md border-2 border-red-400 bg-red-50 text-xs font-bold text-red-700 hover:bg-red-100"
                        disabled={isConfirmingPayment || isTransactionsMutating}
                        onClick={() => removeFromCart(item.activity.id, item.priceType)}
                        title="Remove item"
                      >
                        ✕
                      </button>
                    </div>
                    
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
                        <button
                          type="button"
                          className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-300 text-sm font-bold text-slate-700 hover:bg-white"
                          disabled={isConfirmingPayment || isTransactionsMutating}
                          onClick={() => updateCartQuantity(item.activity.id, item.priceType, item.quantity - 1)}
                        >
                          -
                        </button>
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={item.quantity}
                          inputMode="numeric"
                          className="h-7 w-12 rounded border border-slate-300 px-1.5 text-center text-sm font-bold"
                          disabled={isConfirmingPayment || isTransactionsMutating}
                          onChange={(event) => {
                            const parsed = Number.parseInt(event.target.value, 10);
                            updateCartQuantity(item.activity.id, item.priceType, Number.isFinite(parsed) ? parsed : 1);
                          }}
                        />
                        <button
                          type="button"
                          className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-300 text-sm font-bold text-slate-700 hover:bg-white"
                          disabled={isConfirmingPayment || isTransactionsMutating}
                          onClick={() => updateCartQuantity(item.activity.id, item.priceType, item.quantity + 1)}
                        >
                          +
                        </button>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-slate-600">{formatCurrency(unitPrice)}</p>
                        <p className="font-bold text-slate-900">{formatCurrency(unitPrice * item.quantity)}</p>
                      </div>
                    </div>
                  </div>
                );
              })}

              {cartItems.length === 0 ? (
                <div className="rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center">
                  <p className="text-3xl mb-2">🛒</p>
                  <p className="text-sm font-semibold text-slate-600">No items yet</p>
                  <p className="text-xs text-slate-500 mt-1">Select activities to add</p>
                </div>
              ) : null}
            </div>

            <div className="mt-4 rounded-xl border-3 border-yellow-400 bg-slate-900 p-4 text-white">
              <p className="text-xs font-bold uppercase tracking-widest text-yellow-300">Cart Total</p>
              <p className="mt-2 text-3xl font-bold text-yellow-400">{formatCurrency(cartSummary.totalAmount)}</p>
              <p className="mt-1 text-xs text-slate-300">{cartSummary.totalTickets} ticket(s)</p>
            </div>

            {paymentError ? (
              <p className="mt-3 rounded-lg border-2 border-red-400 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                {paymentError}
              </p>
            ) : null}

            <Button
              type="button"
              className="mt-4 w-full h-14 rounded-xl border-2 border-green-600 bg-green-600 text-lg font-bold text-white hover:bg-green-700"
              disabled={cartItems.length === 0 || isConfirmingPayment || isTransactionsMutating}
              onClick={() => {
                setPaymentError(null);
                setIsPaymentOpen(true);
              }}
            >
              {isConfirmingPayment ? 'Processing...' : 'Checkout'}
            </Button>

          </div>

          <DailySummary
            summary={dailySummary}
            activeGroupId={summary.currentGroupId}
            activeGroupCount={summary.transactionCount}
            activeGroupAmount={summary.groupTotalAmount}
          />
        </div>
      </div>

      <div className="mt-6">
        <TransactionHistory
          transactions={transactions}
          activitiesById={activityById}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          isLoading={isTransactionsLoading}
          cancellingTransactionId={cancellingTransactionId}
          onCancelTransaction={handleCancelTransaction}
          onExchangeTransaction={handleOpenExchangeModal}
          onLoadMore={loadMore}
          hasMore={searchQuery.trim().length < 2 && hasMore}
          isLoadingMore={isLoadingMore}
          onReprintTransaction={(transactionId) => {
            const t = transactions.find((txn) => txn.id === transactionId);
            if (t) {
              const fallbackName = activities.find((a) => a.id === t.activity_id)?.name ?? 'Unknown Activity';
              setPreviewTickets([{
                id: t.id,
                token_number: t.token_number,
                token_index: t.token_index,
                token_total: t.token_total,
                price_type: t.price_type,
                amount: t.amount,
                activityName: fallbackName,
                cashierName: user?.display_name ?? 'Staff',
                created_at: t.created_at,
                txn_reference: t.txn_reference,
              }]);
            }
          }}
          onReprintGroup={(groupId) => {
            const groupTxns = transactions.filter(t => t.transaction_group_id === groupId && !t.cancelled_at);
            if (groupTxns.length > 0) {
              setPreviewTickets(groupTxns.map((t) => {
                const fallbackName = activities.find((a) => a.id === t.activity_id)?.name ?? 'Unknown Activity';
                return {
                  id: t.id,
                  token_number: t.token_number,
                  token_index: t.token_index,
                  token_total: t.token_total,
                  price_type: t.price_type,
                  amount: t.amount,
                  activityName: fallbackName,
                  cashierName: user?.display_name ?? 'Staff',
                  created_at: t.created_at,
                  txn_reference: t.txn_reference,
                };
              }));
            }
          }}
        />
      </div>

      <PaymentConfirmation
        open={isPaymentOpen}
        items={cartItems}
        error={paymentError}
        isSubmitting={isConfirmingPayment || isTransactionsMutating}
        onQuantityChange={updateCartQuantity}
        onRemoveItem={removeFromCart}
        onCancel={() => {
          if (isConfirmingPayment) {
            return;
          }

          setIsPaymentOpen(false);
          setPaymentError(null);
        }}
        onConfirm={handleConfirmPayment}
      />

      <div className="pointer-events-none fixed right-4 top-4 z-[60] w-full max-w-sm space-y-2">
        {notifications.map((item) => (
          <div
            key={item.id}
            className={`pointer-events-auto rounded-lg border px-3 py-2 shadow-md ${
              item.type === 'error'
                ? 'border-red-200 bg-red-50 text-red-800'
                : item.type === 'warning'
                  ? 'border-amber-200 bg-amber-50 text-amber-800'
                  : item.type === 'success'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-slate-200 bg-white text-slate-800'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">{item.title}</p>
                {item.message ? <p className="text-xs opacity-90">{item.message}</p> : null}
              </div>
              <button
                type="button"
                className="text-xs font-medium opacity-70 hover:opacity-100"
                onClick={() => removeNotification(item.id)}
              >
                Close
              </button>
            </div>
          </div>
        ))}
      </div>
    </main>

      <TicketPreview
        open={previewTickets.length > 0}
        tickets={previewTickets}
        onClose={() => {
          setPreviewTickets([]);
        }}
      />

      {exchangeTxnId && (() => {
        const originalTxn = transactions.find(t => t.id === exchangeTxnId);
        const availableSplitOptions = originalTxn
          ? (Object.keys(EXCHANGE_SPLIT_TEMPLATES) as ExchangeSplitOption[]).filter(
              (option) => EXCHANGE_SPLIT_TEMPLATES[option].forAmount === Number(originalTxn.amount)
            )
          : [];
        const activeTemplate = exchangeMode !== 'swap' ? EXCHANGE_SPLIT_TEMPLATES[exchangeMode] : null;
        const confirmDisabled =
          isExchanging ||
          (exchangeMode === 'swap'
            ? !exchangeTargetActivityId
            : splitActivityIds.length === 0 || splitActivityIds.some((id) => !id));

        return (
        <div className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="mb-4 text-xl font-bold text-slate-800">Exchange Ticket</h2>

            {availableSplitOptions.length > 0 && (
              <div className="mb-4 space-y-2">
                <label className="text-sm font-semibold text-slate-700">Exchange Option</label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={`rounded-lg border-2 px-3 py-2 text-xs font-bold transition-colors ${
                      exchangeMode === 'swap'
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                    }`}
                    onClick={() => handleSelectExchangeMode('swap')}
                    disabled={isExchanging}
                  >
                    Same-price swap
                  </button>
                  {availableSplitOptions.map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={`rounded-lg border-2 px-3 py-2 text-xs font-bold transition-colors ${
                        exchangeMode === option
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                      }`}
                      onClick={() => handleSelectExchangeMode(option)}
                      disabled={isExchanging}
                    >
                      {EXCHANGE_SPLIT_TEMPLATES[option].label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {exchangeMode === 'swap' ? (
              <>
                <div className="mb-4 text-sm text-slate-600">
                  <p>Select a new activity to exchange this ticket for.</p>
                  <p className="mt-1 font-semibold text-slate-800">Note: Only activities matching the exact original price are shown.</p>
                </div>

                <div className="mb-6 space-y-2">
                  <label className="text-sm font-semibold text-slate-700">New Activity</label>
                  <select
                    className="w-full rounded-xl border-2 border-slate-300 p-3 outline-none focus:border-blue-500"
                    value={exchangeTargetActivityId || ''}
                    onChange={(e) => setExchangeTargetActivityId(e.target.value)}
                    disabled={isExchanging}
                  >
                    <option value="" disabled>Select an activity</option>
                    {originalTxn && activities
                      .filter(a => {
                        const activityPrice = originalTxn.price_type === 'local' ? a.local_price : a.foreign_price;
                        return Number(activityPrice) === Number(originalTxn.amount);
                      })
                      .map(a => (
                        <option key={a.id} value={a.id}>{a.name} ({formatCurrency(originalTxn.price_type === 'local' ? a.local_price : a.foreign_price)})</option>
                      ))}
                  </select>
                </div>
              </>
            ) : (
              activeTemplate && originalTxn && (
                <>
                  <div className="mb-4 text-sm text-slate-600">
                    <p>Select an activity for each new ticket.</p>
                    <p className="mt-1 font-semibold text-slate-800">
                      {formatCurrency(Number(originalTxn.amount))} → {activeTemplate.denominations.length} tickets, total {formatCurrency(activeTemplate.forAmount)}
                    </p>
                  </div>

                  <div className="mb-6 space-y-3">
                    {activeTemplate.denominations.map((denomination, slot) => (
                      <div key={slot} className="space-y-2">
                        <label className="text-sm font-semibold text-slate-700">
                          Ticket {slot + 1} — {formatCurrency(denomination)}
                        </label>
                        <select
                          className="w-full rounded-xl border-2 border-slate-300 p-3 outline-none focus:border-blue-500"
                          value={splitActivityIds[slot] || ''}
                          onChange={(e) =>
                            setSplitActivityIds((current) =>
                              current.map((id, index) => (index === slot ? e.target.value : id))
                            )
                          }
                          disabled={isExchanging}
                        >
                          <option value="" disabled>Select an activity</option>
                          {activities
                            .filter(a => {
                              const activityPrice = originalTxn.price_type === 'local' ? a.local_price : a.foreign_price;
                              return Number(activityPrice) === denomination;
                            })
                            .map(a => (
                              <option key={a.id} value={a.id}>{a.name} ({formatCurrency(denomination)})</option>
                            ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </>
              )
            )}

            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={handleCloseExchangeModal}
                disabled={isExchanging}
              >
                Cancel
              </Button>
              <Button
                className="bg-blue-600 font-bold text-white hover:bg-blue-700"
                onClick={handleConfirmExchange}
                disabled={confirmDisabled}
              >
                {isExchanging ? 'Exchanging...' : 'Confirm Exchange'}
              </Button>
            </div>
          </div>
        </div>
        );
      })()}
    </>
  );
}
