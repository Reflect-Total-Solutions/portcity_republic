import { NextResponse } from 'next/server';
import { EXCHANGE_SPLIT_TEMPLATES } from '@/lib/constants';
import { requireRequestUser } from '@/lib/request-user';
import { ExchangeSplitSchema, validateInput } from '@/lib/schemas';
import { supabaseServer } from '@/lib/supabase-server';
import { resequenceGroupTransactions } from '@/lib/transactions';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRequestUser();

    const { id: transactionId } = await params;
    if (!transactionId) {
      return NextResponse.json(
        { error: 'Transaction ID is required' },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => null);

    // Split exchange: one ticket becomes several lower-denomination tickets.
    // The legacy `{ activity_id }` same-price swap continues below unchanged.
    if (body?.split) {
      return handleSplitExchange(transactionId, body.split, user.id);
    }

    const newActivityId = body?.activity_id as string | undefined;
    if (!newActivityId) {
      return NextResponse.json(
        { error: 'New Activity ID is required' },
        { status: 400 }
      );
    }

    // 1. Fetch + validate original
    const { data: rawOriginal, error: fetchError } = await supabaseServer
      .from('transactions')
      .select('*')
      .eq('id', transactionId)
      .single();

    if (fetchError || !rawOriginal) {
      return NextResponse.json(
        { error: 'Original transaction not found' },
        { status: 404 }
      );
    }
    const original = rawOriginal as any;

    if (original.cancelled_at) {
      return NextResponse.json(
        { error: 'Cannot exchange a cancelled transaction' },
        { status: 400 }
      );
    }
    if (original.exchanged_to_transaction_id) {
      return NextResponse.json(
        { error: 'This transaction has already been exchanged' },
        { status: 400 }
      );
    }

    // 2. Fetch original token number to preserve it across exchanges
    const { data: rawExistingToken } = await supabaseServer
      .from('tokens')
      .select('token_number')
      .eq('transaction_id', transactionId)
      .maybeSingle();

    const existingTokenData = rawExistingToken as { token_number: string } | null;
    let tokenNumber: string | null = existingTokenData?.token_number ?? null;

    // Fallback: If not directly on this transaction, traverse exchange chain back to root
    if (!tokenNumber && original.exchanged_from_transaction_id) {
      let currentFromId: string | null = original.exchanged_from_transaction_id;
      while (currentFromId && !tokenNumber) {
        const { data: rawParentToken } = await supabaseServer
          .from('tokens')
          .select('token_number')
          .eq('transaction_id', currentFromId)
          .maybeSingle();

        const parentToken = rawParentToken as { token_number: string } | null;
        if (parentToken?.token_number) {
          tokenNumber = parentToken.token_number;
          break;
        }

        const { data: rawParentTxn } = await supabaseServer
          .from('transactions')
          .select('exchanged_from_transaction_id')
          .eq('id', currentFromId)
          .maybeSingle();

        const parentTxn = rawParentTxn as { exchanged_from_transaction_id: string | null } | null;
        currentFromId = parentTxn?.exchanged_from_transaction_id ?? null;
      }
    }

    // If still no token number found, generate one as safeguard
    if (!tokenNumber) {
      const tokenNumberResult = await supabaseServer.rpc('generate_token_number');
      tokenNumber = (tokenNumberResult.data as unknown as string | null) ?? null;
      if (!tokenNumber) {
        return NextResponse.json(
          { error: 'Unable to generate token number' },
          { status: 500 }
        );
      }
    }

    // 3. Fetch + validate new activity
    const { data: rawActivity, error: actError } = await supabaseServer
      .from('activities')
      .select('*')
      .eq('id', newActivityId)
      .single();

    if (actError || !rawActivity) {
      return NextResponse.json(
        { error: 'New activity not found' },
        { status: 404 }
      );
    }
    const newActivity = rawActivity as any;

    if (newActivity.is_active === false) {
      return NextResponse.json(
        { error: 'Target activity is inactive' },
        { status: 400 }
      );
    }

    const expectedPrice =
      original.price_type === 'local'
        ? newActivity.local_price
        : newActivity.foreign_price;

    if (Number(expectedPrice) !== Number(original.amount)) {
      return NextResponse.json(
        { error: 'Price mismatch. Exchange is only valid for activities with the exact same price.' },
        { status: 400 }
      );
    }

    // 4. Generate reference via existing helpers
    const txnRefResult = await supabaseServer.rpc('generate_txn_reference', { suffix: 'E' } as never);
    const txnReference = txnRefResult.data as unknown as string | null;
    if (!txnReference) {
      return NextResponse.json(
        { error: 'Unable to generate transaction reference' },
        { status: 500 }
      );
    }

    // 5. Insert new transaction (token_index/total left null → resequence sets them)
    const { data: rawNew, error: insertErr } = await supabaseServer
      .from('transactions')
      .insert({
        transaction_group_id: original.transaction_group_id,
        cashier_id: user.id,
        activity_id: newActivityId,
        price_type: original.price_type,
        amount: original.amount,
        txn_reference: txnReference,
        print_status: 'pending',
        exchanged_from_transaction_id: transactionId,
        is_exchanged: false,
      } as any)
      .select()
      .single();

    if (insertErr || !rawNew) {
      console.error('Exchange: insert new transaction failed:', insertErr);
      return NextResponse.json(
        { error: 'Failed to create exchanged transaction' },
        { status: 500 }
      );
    }
    const newTxn = rawNew as any;

    // Rollback helpers — track what committed so we can undo in reverse.
    let originalMutated = false;
    let tokenReassigned = false;
    const rollback = async (stage: string, err: unknown) => {
      console.error(`Exchange: rollback at ${stage}:`, err);
      if (tokenReassigned) {
        await supabaseServer
          .from('tokens')
          .update({
            transaction_id: transactionId,
          } as never)
          .eq('token_number', tokenNumber);
      } else {
        await supabaseServer
          .from('tokens')
          .delete()
          .eq('transaction_id', newTxn.id);
      }
      if (originalMutated) {
        await supabaseServer
          .from('transactions')
          .update({
            cancelled_at: null,
            exchanged_to_transaction_id: null,
            is_exchanged: false,
          } as never)
          .eq('id', transactionId);
      }
      await supabaseServer.from('transactions').delete().eq('id', newTxn.id);
    };

    // 6. Cancel original + flag + link to replacement
    const { error: cancelErr } = await supabaseServer
      .from('transactions')
      .update({
        cancelled_at: new Date().toISOString(),
        exchanged_to_transaction_id: newTxn.id,
        is_exchanged: true,
      } as never)
      .eq('id', transactionId);

    if (cancelErr) {
      await rollback('cancel-original', cancelErr);
      return NextResponse.json(
        { error: 'Failed to cancel original transaction' },
        { status: 500 }
      );
    }
    originalMutated = true;

    // 7. Resequence the active siblings (cancelled original is now excluded)
    let sequenced;
    try {
      sequenced = await resequenceGroupTransactions(
        supabaseServer as any,
        original.transaction_group_id
      );
    } catch (seqErr) {
      await rollback('resequence', seqErr);
      return NextResponse.json(
        { error: 'Failed to resequence transaction group' },
        { status: 500 }
      );
    }

    const tokenIndex =
      sequenced.transactions.findIndex((row: any) => row.id === newTxn.id) + 1;
    const tokenTotal = sequenced.total;

    if (tokenIndex <= 0) {
      await rollback('resolve-token-position', null);
      return NextResponse.json(
        { error: 'Failed to resolve token position' },
        { status: 500 }
      );
    }

    // 8. Reassign existing token row to new transaction (preserving exact token number)
    // or insert if this token row didn't exist yet
    if (existingTokenData) {
      const { error: tokenUpdateErr } = await supabaseServer
        .from('tokens')
        .update({
          transaction_id: newTxn.id,
          token_index: tokenIndex,
          token_total: tokenTotal,
          printed_at: new Date().toISOString(),
        } as never)
        .eq('token_number', tokenNumber);

      if (tokenUpdateErr) {
        await rollback('update-token', tokenUpdateErr);
        return NextResponse.json(
          { error: 'Failed to update token for exchanged transaction' },
          { status: 500 }
        );
      }
      tokenReassigned = true;
    } else {
      const { error: tokenErr } = await supabaseServer
        .from('tokens')
        .insert({
          transaction_id: newTxn.id,
          token_number: tokenNumber,
          token_index: tokenIndex,
          token_total: tokenTotal,
          printed_at: new Date().toISOString(),
        } as any);

      if (tokenErr) {
        await rollback('insert-token', tokenErr);
        return NextResponse.json(
          { error: 'Failed to create token for exchanged transaction' },
          { status: 500 }
        );
      }
    }

    // 8. Audit log — best-effort, must never cause a 500 that loses the
    // already-committed exchange writes (no rollback possible at this stage).
    try {
      await supabaseServer.from('audit_log').insert({
        user_id: user.id,
        action: 'EXCHANGE',
        entity_type: 'transaction',
        entity_id: transactionId,
        metadata: {
          new_transaction_id: newTxn.id,
          old_activity_id: original.activity_id,
          new_activity_id: newActivityId,
          amount: original.amount,
          token_number: tokenNumber,
          token_index: tokenIndex,
          token_total: tokenTotal,
        },
      } as any);
    } catch (auditErr) {
      console.error('Exchange: audit_log insert failed (non-fatal):', auditErr);
    }

    return NextResponse.json({
      success: true,
      original_id: transactionId,
      new_transaction: {
        ...newTxn,
        token_index: tokenIndex,
        token_total: tokenTotal,
        token_number: tokenNumber,
      },
    });
  } catch (error) {
    console.error('Exchange error:', error);
    return NextResponse.json(
      { error: 'Internal server error processing exchange' },
      { status: 500 }
    );
  }
}

type SplitOriginalRow = {
  transaction_group_id: string;
  activity_id: string;
  price_type: 'local' | 'foreign';
  amount: number;
  cancelled_at: string | null;
  is_exchanged: boolean | null;
  exchanged_to_transaction_id: string | null;
  exchanged_from_transaction_id: string | null;
};

type SplitActivityRow = {
  id: string;
  is_active: boolean | null;
  local_price: number;
  foreign_price: number;
};

type SplitNewTxnRow = {
  id: string;
  activity_id: string;
  amount: number;
  [key: string]: unknown;
};

async function handleSplitExchange(
  transactionId: string,
  splitPayload: unknown,
  userId: string
) {
  const validation = validateInput(ExchangeSplitSchema, splitPayload);
  if (!validation.valid) {
    return NextResponse.json(
      { error: 'Invalid split exchange payload', details: validation.errors },
      { status: 400 }
    );
  }

  const { option, activity_ids: activityIds } = validation.data;
  const template = EXCHANGE_SPLIT_TEMPLATES[option];
  const denominations: readonly number[] = template.denominations;

  if (activityIds.length !== denominations.length) {
    return NextResponse.json(
      { error: `The "${template.label}" option requires exactly ${denominations.length} activities` },
      { status: 400 }
    );
  }

  // 1. Fetch + validate original (same rules as the same-price swap)
  const { data: rawOriginal, error: fetchError } = await supabaseServer
    .from('transactions')
    .select('*')
    .eq('id', transactionId)
    .single();

  if (fetchError || !rawOriginal) {
    return NextResponse.json(
      { error: 'Original transaction not found' },
      { status: 404 }
    );
  }
  const original = rawOriginal as unknown as SplitOriginalRow;

  if (original.cancelled_at) {
    return NextResponse.json(
      { error: 'Cannot exchange a cancelled transaction' },
      { status: 400 }
    );
  }
  if (original.exchanged_to_transaction_id) {
    return NextResponse.json(
      { error: 'This transaction has already been exchanged' },
      { status: 400 }
    );
  }

  if (Number(original.amount) !== template.forAmount) {
    return NextResponse.json(
      { error: 'This ticket amount cannot be split into the selected option' },
      { status: 400 }
    );
  }

  // 2. Fetch + validate the target activity for each slot. The same activity
  // may fill several slots (e.g. three tickets for one 500-rupee activity).
  const { data: rawActivities, error: actError } = await supabaseServer
    .from('activities')
    .select('*')
    .in('id', [...new Set(activityIds)]);

  if (actError) {
    return NextResponse.json(
      { error: 'Failed to load target activities' },
      { status: 500 }
    );
  }
  const activityById = new Map(
    ((rawActivities ?? []) as unknown as SplitActivityRow[]).map((a) => [a.id, a] as const)
  );

  for (let slot = 0; slot < denominations.length; slot += 1) {
    const activity = activityById.get(activityIds[slot]);
    if (!activity) {
      return NextResponse.json(
        { error: `Activity for ticket ${slot + 1} not found` },
        { status: 404 }
      );
    }
    if (activity.is_active === false) {
      return NextResponse.json(
        { error: `Activity for ticket ${slot + 1} is inactive` },
        { status: 400 }
      );
    }

    const expectedPrice =
      original.price_type === 'local'
        ? activity.local_price
        : activity.foreign_price;

    if (Number(expectedPrice) !== denominations[slot]) {
      return NextResponse.json(
        { error: `Price mismatch. Ticket ${slot + 1} must be an activity priced at exactly ${denominations[slot]}.` },
        { status: 400 }
      );
    }
  }

  // 3. Generate references + token numbers up front so failures happen
  // before any rows are written.
  const txnReferences: string[] = [];
  const tokenNumbers: string[] = [];
  for (let slot = 0; slot < denominations.length; slot += 1) {
    // The reference is millisecond-timestamp based; retry if two calls land in
    // the same millisecond so the batch never violates the unique constraint.
    let txnReference: string | null = null;
    for (let attempt = 0; attempt < 3 && !txnReference; attempt += 1) {
      const txnRefResult = await supabaseServer.rpc('generate_txn_reference', { suffix: 'E' } as never);
      const candidate = txnRefResult.data as unknown as string | null;
      if (candidate && !txnReferences.includes(candidate)) {
        txnReference = candidate;
      }
    }
    if (!txnReference) {
      return NextResponse.json(
        { error: 'Unable to generate transaction reference' },
        { status: 500 }
      );
    }
    txnReferences.push(txnReference);

    const tokenNumberResult = await supabaseServer.rpc('generate_token_number');
    const tokenNumber = tokenNumberResult.data as unknown as string | null;
    if (!tokenNumber) {
      return NextResponse.json(
        { error: 'Unable to generate token number' },
        { status: 500 }
      );
    }
    tokenNumbers.push(tokenNumber);
  }

  // 4. Insert all new transactions in one call (token_index/total left null →
  // resequence sets them)
  const { data: rawNew, error: insertErr } = await supabaseServer
    .from('transactions')
    .insert(
      denominations.map((denomination, slot) => ({
        transaction_group_id: original.transaction_group_id,
        cashier_id: userId,
        activity_id: activityIds[slot],
        price_type: original.price_type,
        amount: denomination,
        txn_reference: txnReferences[slot],
        print_status: 'pending',
        exchanged_from_transaction_id: transactionId,
        is_exchanged: true,
      })) as never
    )
    .select();

  const newTxns = (rawNew ?? []) as unknown as SplitNewTxnRow[];
  if (insertErr || newTxns.length !== denominations.length) {
    console.error('Split exchange: insert new transactions failed:', insertErr);
    return NextResponse.json(
      { error: 'Failed to create exchanged transactions' },
      { status: 500 }
    );
  }
  const newIds = newTxns.map((t) => t.id);

  // Rollback helpers — track what committed so we can undo in reverse.
  let originalMutated = false;
  const rollback = async (stage: string, err: unknown) => {
    console.error(`Split exchange: rollback at ${stage}:`, err);
    await supabaseServer.from('tokens').delete().in('transaction_id', newIds);
    if (originalMutated) {
      await supabaseServer
        .from('transactions')
        .update({
          cancelled_at: null,
          exchanged_to_transaction_id: null,
          is_exchanged: false,
        } as never)
        .eq('id', transactionId);
    }
    await supabaseServer.from('transactions').delete().in('id', newIds);
    try {
      await resequenceGroupTransactions(
        supabaseServer as never,
        original.transaction_group_id
      );
    } catch (reseqErr) {
      console.error('Split exchange: rollback resequence failed:', reseqErr);
    }
  };

  // 5. Cancel original + flag + link to the first replacement. The update is
  // conditional so a concurrent exchange of the same ticket loses the race.
  const { data: cancelledRows, error: cancelErr } = await supabaseServer
    .from('transactions')
    .update({
      cancelled_at: new Date().toISOString(),
      exchanged_to_transaction_id: newIds[0],
      is_exchanged: true,
    } as never)
    .eq('id', transactionId)
    .is('cancelled_at', null)
    .is('exchanged_to_transaction_id', null)
    .select();

  if (cancelErr || !cancelledRows || (cancelledRows as unknown[]).length === 0) {
    await rollback('cancel-original', cancelErr);
    return NextResponse.json(
      { error: cancelErr ? 'Failed to cancel original transaction' : 'This transaction was exchanged by another request' },
      { status: cancelErr ? 500 : 409 }
    );
  }
  originalMutated = true;

  // 6. Resequence the active siblings (cancelled original is now excluded)
  let sequenced;
  try {
    sequenced = await resequenceGroupTransactions(
      supabaseServer as never,
      original.transaction_group_id
    );
  } catch (seqErr) {
    await rollback('resequence', seqErr);
    return NextResponse.json(
      { error: 'Failed to resequence transaction group' },
      { status: 500 }
    );
  }

  const tokenTotal = sequenced.total;
  const tokenIndexes = newIds.map(
    (id) => sequenced.transactions.findIndex((row) => row.id === id) + 1
  );

  if (tokenIndexes.some((index) => index <= 0)) {
    await rollback('resolve-token-position', null);
    return NextResponse.json(
      { error: 'Failed to resolve token position' },
      { status: 500 }
    );
  }

  // 7. Insert token rows for all new transactions
  const { error: tokenErr } = await supabaseServer
    .from('tokens')
    .insert(
      newIds.map((id, slot) => ({
        transaction_id: id,
        token_number: tokenNumbers[slot],
        token_index: tokenIndexes[slot],
        token_total: tokenTotal,
        printed_at: new Date().toISOString(),
      })) as never
    );

  if (tokenErr) {
    await rollback('insert-tokens', tokenErr);
    return NextResponse.json(
      { error: 'Failed to create tokens for exchanged transactions' },
      { status: 500 }
    );
  }

  // 8. Audit log — best-effort, must never cause a 500 that loses the
  // already-committed exchange writes.
  try {
    await supabaseServer.from('audit_log').insert({
      user_id: userId,
      action: 'EXCHANGE',
      entity_type: 'transaction',
      entity_id: transactionId,
      metadata: {
        split_option: option,
        new_transaction_ids: newIds,
        old_activity_id: original.activity_id,
        original_amount: original.amount,
        items: newTxns.map((t, slot) => ({
          transaction_id: t.id,
          activity_id: t.activity_id,
          amount: t.amount,
          token_number: tokenNumbers[slot],
          token_index: tokenIndexes[slot],
        })),
        token_total: tokenTotal,
      },
    } as never);
  } catch (auditErr) {
    console.error('Split exchange: audit_log insert failed (non-fatal):', auditErr);
  }

  return NextResponse.json({
    success: true,
    original_id: transactionId,
    option,
    new_transactions: newTxns.map((t, slot) => ({
      ...t,
      token_number: tokenNumbers[slot],
      token_index: tokenIndexes[slot],
      token_total: tokenTotal,
    })),
  });
}
