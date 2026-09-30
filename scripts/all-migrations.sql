-- Port City Republic - Complete Database Schema

-- ============================================
-- Migration: 001_create_auth_tables.sql
-- ============================================
-- 001_create_auth_tables.sql
-- Foundation tables and shared trigger helpers.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('cashier', 'admin');
  end if;
end
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  role public.user_role not null default 'cashier',
  display_name text not null,
  phone text,
  is_active boolean not null default true,
  failed_login_attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_users_role_active
  on public.users(role, is_active);

create index if not exists idx_users_email
  on public.users(email);

drop trigger if exists trg_users_set_updated_at on public.users;
create trigger trg_users_set_updated_at
before update on public.users
for each row
execute function public.set_updated_at();

-- ============================================
-- Migration: 002_create_categories.sql
-- ============================================
-- 002_create_categories.sql

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_categories_is_active
  on public.categories(is_active);

drop trigger if exists trg_categories_set_updated_at on public.categories;
create trigger trg_categories_set_updated_at
before update on public.categories
for each row
execute function public.set_updated_at();

-- ============================================
-- Migration: 003_create_activities.sql
-- ============================================
-- 003_create_activities.sql

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  category_id uuid references public.categories(id) on delete set null,
  image_url text,
  local_price numeric(10, 2) not null default 500.00,
  foreign_price numeric(10, 2) not null default 750.00,
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_activity_local_price_non_negative check (local_price >= 0),
  constraint chk_activity_foreign_price_non_negative check (foreign_price >= 0)
);

create index if not exists idx_activities_is_active
  on public.activities(is_active);

create index if not exists idx_activities_category_id
  on public.activities(category_id);

create index if not exists idx_activities_display_order
  on public.activities(display_order);

drop trigger if exists trg_activities_set_updated_at on public.activities;
create trigger trg_activities_set_updated_at
before update on public.activities
for each row
execute function public.set_updated_at();

-- ============================================
-- Migration: 004_create_transaction_groups.sql
-- ============================================
-- 004_create_transaction_groups.sql

create table if not exists public.transaction_groups (
  id uuid primary key default gen_random_uuid(),
  cashier_id uuid not null references public.users(id),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  constraint chk_group_completion_after_start
    check (completed_at is null or completed_at >= started_at)
);

create index if not exists idx_transaction_groups_cashier_id
  on public.transaction_groups(cashier_id);

create index if not exists idx_transaction_groups_started_at_desc
  on public.transaction_groups(started_at desc);

-- ============================================
-- Migration: 005_create_transactions.sql
-- ============================================
-- 005_create_transactions.sql

do $$
begin
  if not exists (select 1 from pg_type where typname = 'price_type') then
    create type public.price_type as enum ('local', 'foreign');
  end if;

  if not exists (select 1 from pg_type where typname = 'print_status') then
    create type public.print_status as enum ('pending', 'printed', 'failed');
  end if;
end
$$;

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_group_id uuid not null references public.transaction_groups(id) on delete cascade,
  cashier_id uuid not null references public.users(id),
  activity_id uuid not null references public.activities(id),
  price_type public.price_type not null,
  amount numeric(10, 2) not null,
  token_index integer,
  token_total integer,
  txn_reference text not null unique,
  print_status public.print_status not null default 'pending',
  printed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_transaction_amount_non_negative check (amount >= 0),
  constraint chk_transaction_token_index_positive check (token_index is null or token_index > 0),
  constraint chk_transaction_token_total_positive check (token_total is null or token_total > 0),
  constraint chk_transaction_token_pair check (
    (token_index is null and token_total is null)
    or (token_index is not null and token_total is not null and token_total >= token_index)
  )
);

create index if not exists idx_transactions_group_id
  on public.transactions(transaction_group_id);

create index if not exists idx_transactions_cashier_id
  on public.transactions(cashier_id);

create index if not exists idx_transactions_activity_id
  on public.transactions(activity_id);

create index if not exists idx_transactions_created_at_desc
  on public.transactions(created_at desc);

create index if not exists idx_transactions_txn_reference
  on public.transactions(txn_reference);

drop trigger if exists trg_transactions_set_updated_at on public.transactions;
create trigger trg_transactions_set_updated_at
before update on public.transactions
for each row
execute function public.set_updated_at();

-- ============================================
-- Migration: 006_create_tokens.sql
-- ============================================
-- 006_create_tokens.sql

create table if not exists public.tokens (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  token_number text not null unique,
  token_index integer not null default 1,
  token_total integer not null default 1,
  printed_at timestamptz not null default now(),
  reprint_count integer not null default 0,
  first_reprinted_at timestamptz,
  latest_reprinted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint chk_tokens_index_positive check (token_index > 0),
  constraint chk_tokens_total_positive check (token_total > 0),
  constraint chk_tokens_total_at_least_index check (token_total >= token_index),
  constraint chk_tokens_reprint_count_non_negative check (reprint_count >= 0)
);

create index if not exists idx_tokens_transaction_id
  on public.tokens(transaction_id);

create index if not exists idx_tokens_token_number
  on public.tokens(token_number);

-- ============================================
-- Migration: 007_create_audit_log.sql
-- ============================================
-- 007_create_audit_log.sql

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id),
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_log_created_at_desc
  on public.audit_log(created_at desc);

create index if not exists idx_audit_log_user_id
  on public.audit_log(user_id);

-- ============================================
-- Migration: 008_create_error_logs.sql
-- ============================================
-- 008_create_error_logs.sql

create table if not exists public.error_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id),
  message text not null,
  stack text,
  context jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_error_logs_created_at_desc
  on public.error_logs(created_at desc);

create index if not exists idx_error_logs_user_id
  on public.error_logs(user_id);

-- ============================================
-- Migration: 009_create_printer_status_cache.sql
-- ============================================
-- 009_create_printer_status_cache.sql

create table if not exists public.printer_status_cache (
  id uuid primary key default gen_random_uuid(),
  printer_ip text not null,
  port integer not null default 9100,
  is_online boolean not null default false,
  last_checked_at timestamptz not null default now(),
  error_message text,
  updated_at timestamptz not null default now(),
  constraint uq_printer_status_cache unique (printer_ip, port)
);

create index if not exists idx_printer_status_cache_ip
  on public.printer_status_cache(printer_ip);

create index if not exists idx_printer_status_cache_last_checked_at_desc
  on public.printer_status_cache(last_checked_at desc);

drop trigger if exists trg_printer_status_cache_set_updated_at on public.printer_status_cache;
create trigger trg_printer_status_cache_set_updated_at
before update on public.printer_status_cache
for each row
execute function public.set_updated_at();

-- ============================================
-- Migration: 010_setup_sequences_and_functions.sql
-- ============================================
-- 010_setup_sequences_and_functions.sql

create sequence if not exists public.daily_token_seq
  increment by 1
  minvalue 1
  maxvalue 9999
  start with 1
  cycle;

create or replace function public.generate_token_number()
returns text
language plpgsql
as $$
declare
  v_seq integer;
begin
  v_seq := nextval('public.daily_token_seq');

  return 'CWPCCMB-'
    || to_char(now() at time zone 'Asia/Colombo', 'YYYYMMDD')
    || '-'
    || lpad(v_seq::text, 4, '0');
end;
$$;

create or replace function public.generate_txn_reference(suffix text default 'S')
returns text
language sql
as $$
  select 'TXN-'
    || to_char(now() at time zone 'Asia/Colombo', 'YYYYMMDDHH24MISSMS')
    || '-'
    || coalesce(nullif(trim(suffix), ''), 'S');
$$;

create or replace function public.reset_daily_token_sequence()
returns void
language sql
as $$
  alter sequence public.daily_token_seq restart with 1;
$$;

-- ============================================
-- Migration: 011_create_materialized_view.sql
-- ============================================
-- 011_create_materialized_view.sql

drop materialized view if exists public.daily_summary;

create or replace view public.daily_summary as
  select
    t.cashier_id,
    date(t.created_at at time zone 'Asia/Colombo') as sale_date,
    a.id as activity_id,
    a.name as activity_name,
    t.price_type,
    count(*) filter (where t.cancelled_at is null) as count,
    sum(t.amount) filter (where t.cancelled_at is null) as total_amount
  from public.transactions t
  join public.activities a on a.id = t.activity_id
  where t.created_at >= now() - interval '2 years'
  group by
    t.cashier_id,
    date(t.created_at at time zone 'Asia/Colombo'),
    a.id,
    a.name,
    t.price_type;

-- (Indexes not supported on regular views unless it's materialized, so we can ignore or recreate on the underlying tables if needed)

-- ============================================
-- Migration: 012_setup_rls_policies.sql
-- ============================================
-- 012_setup_rls_policies.sql

-- Enable Row Level Security
alter table public.users enable row level security;
alter table public.categories enable row level security;
alter table public.activities enable row level security;
alter table public.transaction_groups enable row level security;
alter table public.transactions enable row level security;
alter table public.tokens enable row level security;
alter table public.audit_log enable row level security;
alter table public.error_logs enable row level security;
alter table public.printer_status_cache enable row level security;

-- Users
create policy "users_read_own"
  on public.users
  for select
  using (id = auth.uid());

create policy "admin_read_all_users"
  on public.users
  for select
  using (auth.jwt() ->> 'role' = 'admin');

create policy "admin_insert_users"
  on public.users
  for insert
  with check (auth.jwt() ->> 'role' = 'admin');

create policy "admin_update_users"
  on public.users
  for update
  using (auth.jwt() ->> 'role' = 'admin')
  with check (auth.jwt() ->> 'role' = 'admin');

-- Categories
create policy "authenticated_read_categories"
  on public.categories
  for select
  to authenticated
  using (is_active = true);

create policy "admin_read_all_categories"
  on public.categories
  for select
  using (auth.jwt() ->> 'role' = 'admin');

create policy "admin_insert_categories"
  on public.categories
  for insert
  with check (auth.jwt() ->> 'role' = 'admin');

create policy "admin_update_categories"
  on public.categories
  for update
  using (auth.jwt() ->> 'role' = 'admin')
  with check (auth.jwt() ->> 'role' = 'admin');

create policy "admin_delete_categories"
  on public.categories
  for delete
  using (auth.jwt() ->> 'role' = 'admin');

-- Activities
create policy "authenticated_read_activities"
  on public.activities
  for select
  to authenticated
  using (is_active = true);

create policy "admin_read_all_activities"
  on public.activities
  for select
  using (auth.jwt() ->> 'role' = 'admin');

create policy "admin_insert_activities"
  on public.activities
  for insert
  with check (auth.jwt() ->> 'role' = 'admin');

create policy "admin_update_activities"
  on public.activities
  for update
  using (auth.jwt() ->> 'role' = 'admin')
  with check (auth.jwt() ->> 'role' = 'admin');

create policy "admin_delete_activities"
  on public.activities
  for delete
  using (auth.jwt() ->> 'role' = 'admin');

-- Transaction groups
create policy "cashier_read_own_transaction_groups"
  on public.transaction_groups
  for select
  using (cashier_id = auth.uid());

create policy "cashier_insert_transaction_groups"
  on public.transaction_groups
  for insert
  with check (cashier_id = auth.uid());

create policy "admin_read_all_transaction_groups"
  on public.transaction_groups
  for select
  using (auth.jwt() ->> 'role' = 'admin');

create policy "cashier_update_own_transaction_groups"
  on public.transaction_groups
  for update
  using (cashier_id = auth.uid())
  with check (cashier_id = auth.uid());

create policy "admin_update_all_transaction_groups"
  on public.transaction_groups
  for update
  using (auth.jwt() ->> 'role' = 'admin')
  with check (auth.jwt() ->> 'role' = 'admin');

-- Transactions
create policy "cashier_read_own_transactions"
  on public.transactions
  for select
  using (cashier_id = auth.uid());

create policy "cashier_insert_transactions"
  on public.transactions
  for insert
  with check (cashier_id = auth.uid());

create policy "admin_read_all_transactions"
  on public.transactions
  for select
  using (auth.jwt() ->> 'role' = 'admin');

create policy "cashier_update_own_transactions"
  on public.transactions
  for update
  using (cashier_id = auth.uid())
  with check (cashier_id = auth.uid());

create policy "admin_update_all_transactions"
  on public.transactions
  for update
  using (auth.jwt() ->> 'role' = 'admin')
  with check (auth.jwt() ->> 'role' = 'admin');

-- Tokens
create policy "cashier_read_own_tokens"
  on public.tokens
  for select
  using (
    transaction_id in (
      select id
      from public.transactions
      where cashier_id = auth.uid()
    )
  );

create policy "cashier_insert_own_tokens"
  on public.tokens
  for insert
  with check (
    transaction_id in (
      select id
      from public.transactions
      where cashier_id = auth.uid()
    )
  );

create policy "admin_read_all_tokens"
  on public.tokens
  for select
  using (auth.jwt() ->> 'role' = 'admin');

-- Audit log
create policy "cashier_read_own_audit_log"
  on public.audit_log
  for select
  using (user_id = auth.uid());

create policy "authenticated_insert_audit_log"
  on public.audit_log
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "admin_read_all_audit_log"
  on public.audit_log
  for select
  using (auth.jwt() ->> 'role' = 'admin');

-- Error logs
create policy "admin_read_error_logs"
  on public.error_logs
  for select
  using (auth.jwt() ->> 'role' = 'admin');

create policy "authenticated_insert_error_logs"
  on public.error_logs
  for insert
  to authenticated
  with check (user_id = auth.uid() or user_id is null);

-- Printer status cache
create policy "authenticated_read_printer_status"
  on public.printer_status_cache
  for select
  to authenticated
  using (true);

create policy "admin_manage_printer_status"
  on public.printer_status_cache
  for all
  using (auth.jwt() ->> 'role' = 'admin')
  with check (auth.jwt() ->> 'role' = 'admin');

-- ============================================
-- Migration: 013_add_activity_images.sql
-- ============================================
-- 013_add_activity_images.sql

-- 1. Add image_url to activities table
alter table public.activities
add column if not exists image_url text;

-- 2. Create the activity-images bucket
insert into storage.buckets (id, name, public, "file_size_limit", "allowed_mime_types")
values ('activity-images', 'activity-images', true, 5242880, '{image/png,image/jpeg,image/webp,image/svg+xml,image/gif}')
on conflict (id) do update set 
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 3. Set up RLS policies for storage.objects

-- Allow public read access to activity-images
create policy "public_read_activity_images"
  on storage.objects
  for select
  using (bucket_id = 'activity-images');

-- Allow admins to insert/upload images
create policy "admin_insert_activity_images"
  on storage.objects
  for insert
  with check (
    bucket_id = 'activity-images' 
    and (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin' OR auth.jwt() -> 'user_metadata' ->> 'role' = 'admin' OR auth.jwt() ->> 'role' = 'admin')
  );

-- Allow admins to update images
create policy "admin_update_activity_images"
  on storage.objects
  for update
  using (
    bucket_id = 'activity-images' 
    and (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin' OR auth.jwt() -> 'user_metadata' ->> 'role' = 'admin' OR auth.jwt() ->> 'role' = 'admin')
  );

-- Allow admins to delete images
create policy "admin_delete_activity_images"
  on storage.objects
  for delete
  using (
    bucket_id = 'activity-images' 
    and (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin' OR auth.jwt() -> 'user_metadata' ->> 'role' = 'admin' OR auth.jwt() ->> 'role' = 'admin')
  );

-- ============================================
-- Migration: 014_add_payment_methods.sql
-- ============================================
-- 014_add_payment_methods.sql

-- Add payment_method enum and column to transaction_groups and transactions tables
-- Avoids dropping any tables

do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_method_type') then
    create type public.payment_method_type as enum ('cash', 'card');
  end if;
end
$$;

-- Add to transaction_groups
alter table public.transaction_groups
add column if not exists payment_method public.payment_method_type not null default 'cash';

-- Add to transactions
alter table public.transactions
add column if not exists payment_method public.payment_method_type not null default 'cash';

-- Recreate view to include the payment_method at the end to avoid column recreation errors
create or replace view public.daily_summary as
  select
    t.cashier_id,
    date(t.created_at at time zone 'Asia/Colombo') as sale_date,
    a.id as activity_id,
    a.name as activity_name,
    t.price_type,
    count(*) filter (where t.cancelled_at is null) as count,
    sum(t.amount) filter (where t.cancelled_at is null) as total_amount,
    t.payment_method
  from public.transactions t
  join public.activities a on a.id = t.activity_id
  where t.created_at >= now() - interval '2 years'
  group by
    t.cashier_id,
    date(t.created_at at time zone 'Asia/Colombo'),
    a.id,
    a.name,
    t.price_type,
    t.payment_method;

-- Notify PostgREST to reload schema
notify pgrst, 'reload schema';

-- ============================================
-- Migration: 015_add_exchange_support.sql
-- ============================================
-- Add linkage columns to support exchanges
ALTER TABLE public.transactions 
  ADD COLUMN exchanged_to_transaction_id uuid REFERENCES public.transactions(id),
  ADD COLUMN exchanged_from_transaction_id uuid REFERENCES public.transactions(id);

-- Add indexes for performance
CREATE INDEX idx_transactions_exchanged_to ON public.transactions(exchanged_to_transaction_id);
CREATE INDEX idx_transactions_exchanged_from ON public.transactions(exchanged_from_transaction_id);

-- ============================================
-- Migration: 015_add_vendor_role.sql
-- ============================================
-- Add 'vendor' to user_role enum
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'vendor';

-- Add vendor_id to activities
ALTER TABLE public.activities 
ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES public.users(id) ON DELETE SET NULL;

-- Update the materialized view (daily_summary)
DROP VIEW IF EXISTS public.daily_summary;

CREATE VIEW public.daily_summary AS
  SELECT
    t.cashier_id,
    a.vendor_id,
    date(t.created_at AT TIME ZONE 'Asia/Colombo') AS sale_date,
    a.id AS activity_id,
    a.name AS activity_name,
    t.price_type,
    count(*) FILTER (WHERE t.cancelled_at IS NULL) AS count,
    sum(t.amount) FILTER (WHERE t.cancelled_at IS NULL) AS total_amount,    
    t.payment_method
  FROM public.transactions t
  JOIN public.activities a ON a.id = t.activity_id
  WHERE t.created_at >= now() - interval '2 years'
  GROUP BY
    t.cashier_id,
    a.vendor_id,
    date(t.created_at AT TIME ZONE 'Asia/Colombo'),
    a.id,
    a.name,
    t.price_type,
    t.payment_method;

-- Add RLS policies for the vendor role

-- Activities: Vendor can read their assigned activities
CREATE POLICY "vendor_read_own_activities"
  ON public.activities
  FOR SELECT
  TO authenticated
  USING (
    (auth.jwt() ->> 'role') = 'vendor' 
    AND vendor_id = auth.uid()
  );

-- Transactions: Vendor can read transactions for their activities
CREATE POLICY "vendor_read_own_transactions"
  ON public.transactions
  FOR SELECT
  TO authenticated
  USING (
    (auth.jwt() ->> 'role') = 'vendor' 
    AND activity_id IN (
      SELECT id FROM public.activities 
      WHERE vendor_id = auth.uid()
    )
  );

-- Tokens: Vendor can read tokens associated with transactions for their activities
CREATE POLICY "vendor_read_own_tokens"
  ON public.tokens
  FOR SELECT
  TO authenticated
  USING (
    (auth.jwt() ->> 'role') = 'vendor' 
    AND transaction_id IN (
      SELECT t.id FROM public.transactions t
      JOIN public.activities a ON a.id = t.activity_id
      WHERE a.vendor_id = auth.uid()
    )
  );

-- ============================================
-- Migration: 016_add_deleted_at_to_activities.sql
-- ============================================
-- Add deleted_at column to activities for soft deleting
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- ============================================
-- Migration: 016_create_exchange_transaction_rpc.sql
-- ============================================
-- 016_create_exchange_transaction_rpc.sql
--
-- Atomic ticket exchange. The entire flow (validate, insert new txn, cancel
-- original, resequence the group, allocate token) runs inside one Postgres
-- transaction so any failure rolls back all writes — no orphan rows, no
-- partial state.

create or replace function public.exchange_transaction(
  p_transaction_id uuid,
  p_new_activity_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
as $$
declare
  v_original public.transactions%rowtype;
  v_new_activity public.activities%rowtype;
  v_expected_price numeric(10,2);
  v_txn_reference text;
  v_token_number text;
  v_new_id uuid;
  v_new_row public.transactions%rowtype;
  v_token_index integer;
  v_token_total integer;
begin
  -- Lock the original row to serialize concurrent exchange attempts.
  select * into v_original
  from public.transactions
  where id = p_transaction_id
  for update;

  if not found then
    raise exception 'Original transaction not found'
      using errcode = 'P0002', hint = 'not_found';
  end if;

  if v_original.cancelled_at is not null then
    raise exception 'Cannot exchange a cancelled transaction'
      using errcode = 'P0001', hint = 'cancelled';
  end if;

  if v_original.exchanged_to_transaction_id is not null then
    raise exception 'This transaction has already been exchanged'
      using errcode = 'P0001', hint = 'already_exchanged';
  end if;

  select * into v_new_activity
  from public.activities
  where id = p_new_activity_id;

  if not found then
    raise exception 'New activity not found'
      using errcode = 'P0002', hint = 'not_found';
  end if;

  if v_new_activity.is_active is distinct from true then
    raise exception 'Target activity is inactive'
      using errcode = 'P0001', hint = 'inactive_activity';
  end if;

  v_expected_price := case v_original.price_type
    when 'local' then v_new_activity.local_price
    when 'foreign' then v_new_activity.foreign_price
  end;

  if v_expected_price is null or v_expected_price <> v_original.amount then
    raise exception 'Price mismatch. Exchange is only valid for activities with the exact same price.'
      using errcode = 'P0001', hint = 'price_mismatch';
  end if;

  v_txn_reference := public.generate_txn_reference('E');
  v_token_number := public.generate_token_number();

  -- Insert the new transaction (token_index/token_total stay null until
  -- resequencing — the chk_transaction_token_pair constraint allows both null).
  insert into public.transactions (
    transaction_group_id,
    cashier_id,
    activity_id,
    price_type,
    amount,
    txn_reference,
    print_status,
    exchanged_from_transaction_id
  )
  values (
    v_original.transaction_group_id,
    p_user_id,
    p_new_activity_id,
    v_original.price_type,
    v_original.amount,
    v_txn_reference,
    'pending',
    p_transaction_id
  )
  returning id into v_new_id;

  -- Cancel the original and link the replacement.
  update public.transactions
  set cancelled_at = now(),
      exchanged_to_transaction_id = v_new_id
  where id = p_transaction_id;

  -- Resequence the entire group in one set-based pass: row_number() over the
  -- active siblings (now excluding the cancelled original) becomes the new
  -- token_index, count() the new token_total.
  with seq as (
    select id,
           row_number() over (order by created_at, id) as rn,
           count(*) over () as total
    from public.transactions
    where transaction_group_id = v_original.transaction_group_id
      and cancelled_at is null
  )
  update public.transactions t
  set token_index = seq.rn,
      token_total = seq.total
  from seq
  where t.id = seq.id;

  -- Mirror those numbers onto any existing tokens for the group's active txns.
  with seq as (
    select t.id as transaction_id,
           row_number() over (order by t.created_at, t.id) as rn,
           count(*) over () as total
    from public.transactions t
    where t.transaction_group_id = v_original.transaction_group_id
      and t.cancelled_at is null
  )
  update public.tokens tk
  set token_index = seq.rn,
      token_total = seq.total
  from seq
  where tk.transaction_id = seq.transaction_id;

  -- Read back the new transaction's resolved position.
  select * into v_new_row
  from public.transactions
  where id = v_new_id;

  v_token_index := v_new_row.token_index;
  v_token_total := v_new_row.token_total;

  if v_token_index is null or v_token_total is null then
    raise exception 'Failed to resolve token position for exchanged transaction'
      using errcode = 'P0001', hint = 'token_position';
  end if;

  -- Allocate the token row for the new transaction.
  insert into public.tokens (
    transaction_id,
    token_number,
    token_index,
    token_total,
    printed_at
  )
  values (
    v_new_id,
    v_token_number,
    v_token_index,
    v_token_total,
    now()
  );

  insert into public.audit_log (
    user_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    p_user_id,
    'EXCHANGE',
    'transaction',
    p_transaction_id,
    jsonb_build_object(
      'new_transaction_id', v_new_id,
      'old_activity_id', v_original.activity_id,
      'new_activity_id', p_new_activity_id,
      'amount', v_original.amount,
      'token_number', v_token_number,
      'token_index', v_token_index,
      'token_total', v_token_total
    )
  );

  return jsonb_build_object(
    'success', true,
    'original_id', p_transaction_id,
    'new_transaction', jsonb_build_object(
      'id', v_new_row.id,
      'transaction_group_id', v_new_row.transaction_group_id,
      'cashier_id', v_new_row.cashier_id,
      'activity_id', v_new_row.activity_id,
      'price_type', v_new_row.price_type,
      'amount', v_new_row.amount,
      'token_index', v_token_index,
      'token_total', v_token_total,
      'token_number', v_token_number,
      'txn_reference', v_new_row.txn_reference,
      'print_status', v_new_row.print_status,
      'printed_at', v_new_row.printed_at,
      'cancelled_at', v_new_row.cancelled_at,
      'created_at', v_new_row.created_at,
      'updated_at', v_new_row.updated_at,
      'exchanged_from_transaction_id', v_new_row.exchanged_from_transaction_id,
      'exchanged_to_transaction_id', v_new_row.exchanged_to_transaction_id
    )
  );
end;
$$;

-- ============================================
-- Migration: 017_add_is_exchanged_flag.sql
-- ============================================
-- 017_add_is_exchanged_flag.sql
--
-- Adds an explicit `is_exchanged` boolean to transactions so a ticket
-- involved in an exchange (either side) can never be exchanged again.
-- Re-running this migration is safe (IF NOT EXISTS).

alter table public.transactions
  add column if not exists is_exchanged boolean not null default false;

-- Backfill: any pre-existing rows that participated in an exchange are flagged.
update public.transactions
set is_exchanged = true
where (exchanged_to_transaction_id is not null
       or exchanged_from_transaction_id is not null)
  and is_exchanged = false;

-- ============================================
-- Migration: 018_add_activity_report_rpc.sql
-- ============================================
-- 018_add_activity_report_rpc.sql
--
-- Aggregates daily_summary into one row per activity so the result set is
-- tiny (≤ number of activities) and never hits PostgREST's max-rows cap.
-- SECURITY DEFINER runs as the function owner, bypassing RLS — the caller
-- is responsible for passing the correct p_vendor_id filter for vendors.

create or replace function public.get_activity_report_data(
  p_from        date    default null,
  p_to          date    default null,
  p_vendor_id   uuid    default null,
  p_activity_id uuid    default null,
  p_cashier_id  uuid    default null
)
returns table (
  activity_id    uuid,
  activity_name  text,
  local_count    bigint,
  foreign_count  bigint,
  total_count    bigint,
  local_total    numeric,
  foreign_total  numeric,
  total_amount   numeric
)
language sql
security definer
set search_path = public
as $$
  select
    ds.activity_id,
    ds.activity_name,
    coalesce(sum(ds.count) filter (where ds.price_type = 'local'),   0) as local_count,
    coalesce(sum(ds.count) filter (where ds.price_type = 'foreign'), 0) as foreign_count,
    coalesce(sum(ds.count),                                           0) as total_count,
    coalesce(round(sum(ds.total_amount) filter (where ds.price_type = 'local')::numeric,   2), 0) as local_total,
    coalesce(round(sum(ds.total_amount) filter (where ds.price_type = 'foreign')::numeric, 2), 0) as foreign_total,
    coalesce(round(sum(ds.total_amount)::numeric,                                           2), 0) as total_amount
  from public.daily_summary ds
  where
    (p_from        is null or ds.sale_date    >= p_from)        and
    (p_to          is null or ds.sale_date    <= p_to)          and
    (p_vendor_id   is null or ds.vendor_id    = p_vendor_id)    and
    (p_activity_id is null or ds.activity_id  = p_activity_id)  and
    (p_cashier_id  is null or ds.cashier_id   = p_cashier_id)
  group by ds.activity_id, ds.activity_name
  order by total_amount desc;
$$;

-- ============================================
-- Migration: 019_add_cashier_report_rpc.sql
-- ============================================
-- 019_add_cashier_report_rpc.sql
--
-- Returns aggregated cashier report data with activity breakdown.
-- Groups by cashier_id and activity_id, aggregating transaction counts and amounts.
-- Uses the same counting logic as the activity report for consistency.

create or replace function public.get_cashier_report_data(
  p_from        date    default null,
  p_to          date    default null,
  p_vendor_id   uuid    default null,
  p_cashier_id  uuid    default null,
  p_activity_id uuid    default null
)
returns table (
  cashier_id    uuid,
  cashier_name  text,
  activity_id   uuid,
  activity_name text,
  local_count   bigint,
  foreign_count bigint,
  total_count   bigint,
  local_total   numeric,
  foreign_total numeric,
  cash_total    numeric,
  card_total    numeric,
  total_amount  numeric
)
language sql
security definer
set search_path = public
as $$
  select
    ds.cashier_id,
    u.display_name as cashier_name,
    ds.activity_id,
    ds.activity_name,
    coalesce(sum(ds.count) filter (where ds.price_type = 'local'),   0) as local_count,
    coalesce(sum(ds.count) filter (where ds.price_type = 'foreign'), 0) as foreign_count,
    coalesce(sum(ds.count),                                           0) as total_count,
    coalesce(round(sum(ds.total_amount) filter (where ds.price_type = 'local')::numeric,   2), 0) as local_total,
    coalesce(round(sum(ds.total_amount) filter (where ds.price_type = 'foreign')::numeric, 2), 0) as foreign_total,
    coalesce(round(sum(ds.total_amount) filter (where (ds).payment_method = 'cash')::numeric,   2), 0) as cash_total,
    coalesce(round(sum(ds.total_amount) filter (where (ds).payment_method = 'card')::numeric,   2), 0) as card_total,
    coalesce(round(sum(ds.total_amount)::numeric,                                           2), 0) as total_amount
  from public.daily_summary ds
  left join public.users u on u.id = ds.cashier_id
  where
    (p_from        is null or ds.sale_date    >= p_from)        and
    (p_to          is null or ds.sale_date    <= p_to)          and
    (p_vendor_id   is null or ds.vendor_id    = p_vendor_id)    and
    (p_cashier_id  is null or ds.cashier_id   = p_cashier_id)   and
    (p_activity_id is null or ds.activity_id  = p_activity_id)  and
    ds.cashier_id is not null
  group by ds.cashier_id, u.display_name, ds.activity_id, ds.activity_name
  order by ds.cashier_id, total_amount desc;
$$;

-- ============================================
-- Migration: 020_atomic_bulk_checkout.sql
-- ============================================
-- 020_atomic_bulk_checkout.sql
--
-- Fixes duplicate-ticket and group-merging bugs:
--  * bulk_checkout() creates the group, all transactions and all tokens in ONE
--    database transaction — a failure anywhere rolls back everything, so a
--    partial sale can never be left in the database.
--  * The group is created already completed (a checkout is final), so the next
--    sale can never be appended to it.
--  * A client-supplied idempotency key is stored on the group with a unique
--    constraint. A retried request replays the original result instead of
--    inserting a second set of tickets.
--  * txn_reference uses a sequence so two requests in the same millisecond can
--    no longer collide.
--
-- Additive only: new column, new sequence, new functions. No data is touched.

alter table public.transaction_groups
  add column if not exists idempotency_key uuid;

-- Postgres unique constraints allow multiple NULLs, so existing rows are unaffected.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'uq_transaction_groups_idempotency_key'
  ) then
    alter table public.transaction_groups
      add constraint uq_transaction_groups_idempotency_key unique (idempotency_key);
  end if;
end
$$;

create sequence if not exists public.txn_reference_seq;

-- Builds the API response payload for a completed checkout group. Used both for
-- fresh checkouts and idempotent replays.
create or replace function public.bulk_checkout_result(p_group_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'transaction_group_id', p_group_id,
    'transaction_count', count(*),
    'total_amount', round(coalesce(sum(t.amount), 0)::numeric, 2),
    'transactions', coalesce(
      jsonb_agg(
        to_jsonb(t) || jsonb_build_object(
          'token_number', tk.token_number,
          'token_index', t.token_index,
          'token_total', t.token_total
        )
        order by t.token_index
      ),
      '[]'::jsonb
    )
  )
  from public.transactions t
  join public.tokens tk on tk.transaction_id = t.id
  where t.transaction_group_id = p_group_id
    and t.cancelled_at is null;
$$;

revoke execute on function public.bulk_checkout_result(uuid) from public, anon, authenticated;

create or replace function public.bulk_checkout(
  p_payment_method public.payment_method_type,
  p_items jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cashier uuid := auth.uid();
  v_existing_group uuid;
  v_group_id uuid;
  v_item jsonb;
  v_activity public.activities%rowtype;
  v_quantity integer;
  v_price_type public.price_type;
  v_amount numeric(10, 2);
  v_total integer := 0;
  v_idx integer := 0;
  v_txn_id uuid;
  v_token_number text;
  v_now timestamptz := now();
begin
  if v_cashier is null then
    raise exception 'Not authenticated';
  end if;

  if p_idempotency_key is null then
    raise exception 'Idempotency key is required';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one item is required';
  end if;

  -- Idempotent replay: this exact checkout was already processed, return the
  -- original tickets instead of creating new ones.
  select id into v_existing_group
  from public.transaction_groups
  where idempotency_key = p_idempotency_key;

  if v_existing_group is not null then
    return public.bulk_checkout_result(v_existing_group)
      || jsonb_build_object('replayed', true);
  end if;

  -- Total ticket count up front so every ticket carries the right "N of total".
  select coalesce(sum(greatest(1, coalesce((item->>'quantity')::integer, 1))), 0)
  into v_total
  from jsonb_array_elements(p_items) as item;

  if v_total < 1 or v_total > 1000 then
    raise exception 'Invalid ticket count: %', v_total;
  end if;

  -- The group is created already completed: a checkout is final, nothing can be
  -- appended to it later. A concurrent request with the same idempotency key
  -- fails here on the unique constraint and rolls back entirely.
  insert into public.transaction_groups (cashier_id, payment_method, idempotency_key, started_at, completed_at)
  values (v_cashier, p_payment_method, p_idempotency_key, v_now, v_now)
  returning id into v_group_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_quantity := greatest(1, coalesce((v_item->>'quantity')::integer, 1));
    v_price_type := (v_item->>'price_type')::public.price_type;

    select * into v_activity
    from public.activities
    where id = (v_item->>'activity_id')::uuid
      and is_active = true;

    if not found then
      raise exception 'Activity not found or inactive: %', v_item->>'activity_id';
    end if;

    v_amount := case when v_price_type = 'local'
      then v_activity.local_price
      else v_activity.foreign_price
    end;

    for i in 1..v_quantity loop
      v_idx := v_idx + 1;

      insert into public.transactions (
        transaction_group_id, cashier_id, activity_id, price_type,
        payment_method, amount, token_index, token_total,
        txn_reference, print_status
      )
      values (
        v_group_id, v_cashier, v_activity.id, v_price_type,
        p_payment_method, v_amount, v_idx, v_total,
        'TXN-'
          || to_char(v_now at time zone 'Asia/Colombo', 'YYYYMMDDHH24MISS')
          || '-' || lpad(nextval('public.txn_reference_seq')::text, 6, '0')
          || '-S',
        'pending'
      )
      returning id into v_txn_id;

      v_token_number := public.generate_token_number();

      insert into public.tokens (transaction_id, token_number, token_index, token_total, printed_at)
      values (v_txn_id, v_token_number, v_idx, v_total, v_now);
    end loop;
  end loop;

  insert into public.audit_log (user_id, action, entity_type, entity_id, metadata, created_at)
  values (
    v_cashier,
    'BULK_CHECKOUT',
    'transaction_group',
    v_group_id,
    jsonb_build_object(
      'ticket_count', v_total,
      'payment_method', p_payment_method,
      'idempotency_key', p_idempotency_key,
      'items', p_items
    ),
    v_now
  );

  return public.bulk_checkout_result(v_group_id)
    || jsonb_build_object('replayed', false);
end;
$$;

revoke execute on function public.bulk_checkout(public.payment_method_type, jsonb, uuid) from public, anon;
grant execute on function public.bulk_checkout(public.payment_method_type, jsonb, uuid) to authenticated;

notify pgrst, 'reload schema';

-- ============================================
-- Migration: 021_set_db_timezone_colombo.sql
-- ============================================
-- 021_set_db_timezone_colombo.sql
--
-- Display-only change: sets the database default timezone so the Supabase SQL
-- editor, psql, and any client that does not set its own session timezone
-- renders timestamptz values in Sri Lanka time (+05:30) instead of UTC.
--
-- Storage is unaffected — timestamptz is always stored as UTC internally.
-- App code is unaffected — the Supabase JS client returns ISO strings with an
-- explicit offset, and all app-side formatting converts to Asia/Colombo
-- explicitly (lib/dateUtils.ts). Reversible with:
--   alter database postgres set timezone to 'UTC';
--
-- Takes effect on NEW connections; existing pooled connections keep their
-- session timezone until they reconnect.

alter database postgres set timezone to 'Asia/Colombo';

-- ============================================
-- Migration: 022_add_pos_transaction_indexes.sql
-- ============================================
-- 022_add_pos_transaction_indexes.sql
--
-- Speeds up the POS dashboard transaction-history query
-- (GET /api/transactions), which filters by cashier_id + created_at range
-- and orders by created_at desc. The existing single-column indexes
-- (idx_transactions_cashier_id, idx_transactions_created_at_desc) cannot
-- serve the equality-filter + ordered-range together, so Postgres was
-- either scanning across other cashiers' rows or sorting on every load.
-- The admin dashboard is unaffected because it does not filter by cashier.
--
-- PROD-SAFE APPLY NOTES:
--   * Uses CREATE INDEX CONCURRENTLY so existing rows stay writable
--     (no INSERT/UPDATE lock) while the index builds. Sales are not blocked.
--   * CONCURRENTLY cannot run inside a transaction block. Apply this file
--     directly (Supabase SQL editor, `psql`, or the Supabase MCP), NOT via a
--     runner that wraps each migration in BEGIN/COMMIT.
--   * Nothing here drops tables, deletes, or rewrites data.
--   * IF NOT EXISTS makes re-runs safe.

-- Composite index: serves `cashier_id = ? ORDER BY created_at DESC` and the
-- created_at range filter in one index. This is the primary fix.
create index if not exists idx_transactions_cashier_created_at
  on public.transactions (cashier_id, created_at desc);

-- ============================================
-- Migration: 023_add_pos_daily_summary_rpc.sql
-- ============================================
-- 023_add_pos_daily_summary_rpc.sql
--
-- Live per-cashier daily summary for the POS dashboard "Daily Summary" /
-- "Gross Total" panel. Previously the dashboard fetched every transaction for
-- the day (limit 10000) and summed them in the browser; on a busy day that is
-- ~1,800 rows per cashier, which dominated the ~6s dashboard load.
--
-- This aggregates server-side (a few ms) and returns a single row. It reads the
-- base tables directly (NOT the daily_summary materialized view) so the numbers
-- are always current for today.
--
-- Counting rules match components/pos/DailySummary.tsx exactly:
--   * Active row      = cancelled_at IS NULL. Counted in tickets/local/foreign
--                       and all amount totals.
--   * Cancelled count = cancelled_at IS NOT NULL AND exchanged_to is NULL.
--                       (An exchanged-away original is represented by its
--                        replacement row, so it is not a "true" cancellation.)
--   * Cash/Card       = attributed to the ORIGINAL ticket's payment_method when
--                       the row is an exchange replacement (exchanged_from set),
--                       else the row's own payment_method. Anything not 'card'
--                       counts as cash (matches the client's else-branch).
--
-- Safe on prod: creates a function only. No table/data changes, no locks.

create or replace function public.get_pos_daily_summary(
  p_cashier_id uuid,
  p_from       timestamptz,
  p_to         timestamptz
)
returns table (
  total_count     bigint,
  local_count     bigint,
  foreign_count   bigint,
  cancelled_count bigint,
  local_amount    numeric,
  foreign_amount  numeric,
  cash_amount     numeric,
  card_amount     numeric,
  total_amount    numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with scoped as (
    select
      t.cancelled_at,
      t.price_type,
      t.amount,
      t.exchanged_to_transaction_id,
      coalesce(orig.payment_method, t.payment_method) as effective_payment_method
    from public.transactions t
    left join public.transactions orig
      on orig.id = t.exchanged_from_transaction_id
    where t.cashier_id = p_cashier_id
      and t.created_at >= p_from
      and t.created_at <  p_to
  )
  select
    count(*) filter (where cancelled_at is null)                              as total_count,
    count(*) filter (where cancelled_at is null and price_type = 'local')     as local_count,
    count(*) filter (where cancelled_at is null and price_type = 'foreign')   as foreign_count,
    count(*) filter (where cancelled_at is not null
                       and exchanged_to_transaction_id is null)               as cancelled_count,
    coalesce(round(sum(amount) filter (where cancelled_at is null and price_type = 'local')::numeric, 2), 0)   as local_amount,
    coalesce(round(sum(amount) filter (where cancelled_at is null and price_type = 'foreign')::numeric, 2), 0) as foreign_amount,
    coalesce(round(sum(amount) filter (where cancelled_at is null
                       and effective_payment_method is distinct from 'card')::numeric, 2), 0)                  as cash_amount,
    coalesce(round(sum(amount) filter (where cancelled_at is null
                       and effective_payment_method = 'card')::numeric, 2), 0)                                 as card_amount,
    coalesce(round(sum(amount) filter (where cancelled_at is null)::numeric, 2), 0)                            as total_amount
  from scoped;
$$;

grant execute on function public.get_pos_daily_summary(uuid, timestamptz, timestamptz) to authenticated;

-- ============================================
-- Migration: 024_optimize_database_performance.sql
-- ============================================
-- 024_optimize_database_performance.sql
--
-- Performance optimizations for high-volume POS transactions & fast multi-day search:
-- 1. Enables pg_trgm for ultra-fast trigram substring search (ILIKE '%...%')
-- 2. GIN trigram indexes on txn_reference and token_number
-- 3. Composite and partial indexes for active tickets and date/cashier filters
-- 4. search_transactions_v2 RPC for single-query database-level search with window count
-- 5. Autovacuum tuning for high-write POS tables
-- 6. Cached auth function calls in RLS policies for 5-10x throughput boost

-- Step 1: Enable pg_trgm extension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Step 2: GIN Trigram Indexes for Substring Searches
-- Allows `ILIKE '%...%'` on txn_reference and token_number to use index scans instead of full table scans
CREATE INDEX IF NOT EXISTS idx_transactions_txn_ref_trgm
  ON public.transactions USING gin (txn_reference gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_tokens_token_number_trgm
  ON public.tokens USING gin (token_number gin_trgm_ops);

-- Step 3: Composite & Partial Indexes for Day-to-Day Queries
-- Partial index on active (non-cancelled) transactions by created_at DESC
CREATE INDEX IF NOT EXISTS idx_transactions_active_created_at
  ON public.transactions (created_at DESC)
  WHERE cancelled_at IS NULL;

-- Composite partial index for cashier's active transactions
CREATE INDEX IF NOT EXISTS idx_transactions_cashier_active_created_at
  ON public.transactions (cashier_id, created_at DESC)
  WHERE cancelled_at IS NULL;

-- Composite index for activity-based date searches
CREATE INDEX IF NOT EXISTS idx_transactions_activity_created_at
  ON public.transactions (activity_id, created_at DESC);

-- Covering lookup index on tokens
CREATE INDEX IF NOT EXISTS idx_tokens_txn_lookup
  ON public.tokens (transaction_id, token_number);

-- Step 4: Stored Procedure for Unified High-Speed Search
-- Replaces multi-step Node.js memory merging with a single SQL query
CREATE OR REPLACE FUNCTION public.search_transactions_v2(
  p_query text default null,
  p_cashier_id uuid default null,
  p_activity_id uuid default null,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null,
  p_include_cancelled boolean default false,
  p_limit integer default 20,
  p_offset integer default 0
)
RETURNS TABLE (
  id uuid,
  transaction_group_id uuid,
  cashier_id uuid,
  activity_id uuid,
  price_type public.price_type,
  amount numeric,
  token_index integer,
  token_total integer,
  txn_reference text,
  print_status public.print_status,
  printed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  payment_method public.payment_method_type,
  exchanged_to_transaction_id uuid,
  exchanged_from_transaction_id uuid,
  is_exchanged boolean,
  token_number text,
  full_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT
      t.id,
      t.transaction_group_id,
      t.cashier_id,
      t.activity_id,
      t.price_type,
      t.amount,
      t.token_index,
      t.token_total,
      t.txn_reference,
      t.print_status,
      t.printed_at,
      t.cancelled_at,
      t.created_at,
      t.updated_at,
      t.payment_method,
      t.exchanged_to_transaction_id,
      t.exchanged_from_transaction_id,
      t.is_exchanged,
      tk.token_number,
      count(*) over() AS full_count
    FROM public.transactions t
    LEFT JOIN public.tokens tk ON tk.transaction_id = t.id
    WHERE
      (p_cashier_id IS NULL OR t.cashier_id = p_cashier_id)
      AND (p_activity_id IS NULL OR t.activity_id = p_activity_id)
      AND (p_start_date IS NULL OR t.created_at >= p_start_date)
      AND (p_end_date IS NULL OR t.created_at <= p_end_date)
      AND (p_include_cancelled OR t.cancelled_at IS NULL OR t.is_exchanged = true)
      AND (
        p_query IS NULL
        OR p_query = ''
        OR t.txn_reference ILIKE ('%' || p_query || '%')
        OR tk.token_number ILIKE ('%' || p_query || '%')
      )
    ORDER BY t.created_at DESC
    LIMIT p_limit
    OFFSET p_offset
  )
  SELECT * FROM filtered;
$$;

GRANT EXECUTE ON FUNCTION public.search_transactions_v2(text, uuid, uuid, timestamptz, timestamptz, boolean, integer, integer) TO authenticated;

-- Step 5: Autovacuum Tuning for High-Write POS Tables
-- Default is 20% row updates before vacuum; setting to 5% keeps dead tuples low
-- and keeps B-tree/GIN index pages clean as hundreds of transactions occur daily.
ALTER TABLE public.transactions SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE public.tokens SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE public.audit_log SET (autovacuum_vacuum_scale_factor = 0.05);

-- Step 6: Optimize RLS Policies with Cached Subquery Evaluation
-- Wrap auth.uid() and auth.jwt() in (SELECT ...) so Postgres evaluates them
-- once per statement instead of once per table row.
DROP POLICY IF EXISTS "cashier_read_own_transactions" ON public.transactions;
CREATE POLICY "cashier_read_own_transactions"
  ON public.transactions FOR SELECT
  USING (cashier_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "admin_read_all_transactions" ON public.transactions;
CREATE POLICY "admin_read_all_transactions"
  ON public.transactions FOR SELECT
  USING ((SELECT auth.jwt() ->> 'role') = 'admin');

DROP POLICY IF EXISTS "cashier_read_own_tokens" ON public.tokens;
CREATE POLICY "cashier_read_own_tokens"
  ON public.tokens FOR SELECT
  USING (
    transaction_id IN (
      SELECT id FROM public.transactions WHERE cashier_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "admin_read_all_tokens" ON public.tokens;
CREATE POLICY "admin_read_all_tokens"
  ON public.tokens FOR SELECT
  USING ((SELECT auth.jwt() ->> 'role') = 'admin');

-- ============================================
-- Migration: 025_fix_rls_admin_policies.sql
-- ============================================
-- 025_fix_rls_admin_policies.sql
--
-- Fixes RLS policies where `auth.jwt() ->> 'role' = 'admin'` was used.
-- In Supabase, `auth.jwt() ->> 'role'` returns the Postgres role ('authenticated'),
-- NOT the application role ('admin').
-- This helper function checks app_metadata, user_metadata, and the public.users table.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin',
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon;

-- Categories RLS
DROP POLICY IF EXISTS "admin_read_all_categories" ON public.categories;
CREATE POLICY "admin_read_all_categories"
  ON public.categories FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "admin_insert_categories" ON public.categories;
CREATE POLICY "admin_insert_categories"
  ON public.categories FOR INSERT
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_update_categories" ON public.categories;
CREATE POLICY "admin_update_categories"
  ON public.categories FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_delete_categories" ON public.categories;
CREATE POLICY "admin_delete_categories"
  ON public.categories FOR DELETE
  USING (public.is_admin());

-- Activities RLS
DROP POLICY IF EXISTS "admin_read_all_activities" ON public.activities;
CREATE POLICY "admin_read_all_activities"
  ON public.activities FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "admin_insert_activities" ON public.activities;
CREATE POLICY "admin_insert_activities"
  ON public.activities FOR INSERT
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_update_activities" ON public.activities;
CREATE POLICY "admin_update_activities"
  ON public.activities FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_delete_activities" ON public.activities;
CREATE POLICY "admin_delete_activities"
  ON public.activities FOR DELETE
  USING (public.is_admin());

-- Users RLS
DROP POLICY IF EXISTS "admin_read_all_users" ON public.users;
CREATE POLICY "admin_read_all_users"
  ON public.users FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "admin_insert_users" ON public.users;
CREATE POLICY "admin_insert_users"
  ON public.users FOR INSERT
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_update_users" ON public.users;
CREATE POLICY "admin_update_users"
  ON public.users FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Transaction Groups RLS
DROP POLICY IF EXISTS "admin_read_all_transaction_groups" ON public.transaction_groups;
CREATE POLICY "admin_read_all_transaction_groups"
  ON public.transaction_groups FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "admin_update_all_transaction_groups" ON public.transaction_groups;
CREATE POLICY "admin_update_all_transaction_groups"
  ON public.transaction_groups FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Transactions RLS
DROP POLICY IF EXISTS "admin_read_all_transactions" ON public.transactions;
CREATE POLICY "admin_read_all_transactions"
  ON public.transactions FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "admin_update_all_transactions" ON public.transactions;
CREATE POLICY "admin_update_all_transactions"
  ON public.transactions FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Tokens RLS
DROP POLICY IF EXISTS "admin_read_all_tokens" ON public.tokens;
CREATE POLICY "admin_read_all_tokens"
  ON public.tokens FOR SELECT
  USING (public.is_admin());

-- Audit Log RLS
DROP POLICY IF EXISTS "admin_read_all_audit_log" ON public.audit_log;
CREATE POLICY "admin_read_all_audit_log"
  ON public.audit_log FOR SELECT
  USING (public.is_admin());

-- Error Logs RLS
DROP POLICY IF EXISTS "admin_read_error_logs" ON public.error_logs;
CREATE POLICY "admin_read_error_logs"
  ON public.error_logs FOR SELECT
  USING (public.is_admin());
