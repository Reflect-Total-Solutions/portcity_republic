/**
 * Seed script – creates the default admin user.
 *
 * Usage:
 *   npx tsx scripts/seed-admin.ts
 *
 * Requirements:
 *   - NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env
 *   - `tsx` installed (npx handles this automatically)
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

/* ---------- configuration ---------- */
const ADMIN_EMAIL = 'admin@gmail.com';
const ADMIN_PASSWORD = '123123123';
const ADMIN_DISPLAY_NAME = 'Admin';
/* ----------------------------------- */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    '❌  Missing env vars: NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY'
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * Execute raw SQL against the Supabase Postgres database
 * using the /rest/v1/rpc endpoint won't work here, so we use
 * the pg_net-free approach: Supabase's /sql endpoint (available with service role).
 */
async function executeSql(sql: string): Promise<void> {
  // Use the Supabase SQL API endpoint
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceRoleKey!,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({
      // This won't work for DDL, but let's try the /sql endpoint instead
    }),
  });
  // This is a fallback — see runMigrations() below
}

/**
 * Run the migration SQL to create the users table via the Supabase SQL API
 */
async function runMigrationSql(sql: string): Promise<{ ok: boolean; error?: string }> {
  // Supabase projects expose a /pg/ SQL endpoint for service role
  // But the standard approach is the /rest/v1/ endpoint.
  // Since we can't run DDL through PostgREST, we'll insert directly via
  // a raw SQL query using the `query` endpoint available on newer Supabase.
  const res = await fetch(`${supabaseUrl}/sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({ query: sql }),
  });

  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: `HTTP ${res.status}: ${text}` };
  }

  return { ok: true };
}

async function ensureUsersTable(): Promise<boolean> {
  // Check if public.users table exists via PostgREST
  const { error } = await supabase.from('users').select('id').limit(0);

  if (!error) {
    return true; // Table exists
  }

  if (!error.message.includes('Could not find the table')) {
    return true; // Table exists but some other issue
  }

  console.log('⚠️   public.users table not found – running migrations...');

  const migrationSQL = `
    -- Create pgcrypto extension
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    -- Create user_role enum
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE public.user_role AS ENUM ('cashier', 'admin');
      END IF;
    END $$;

    -- Create updated_at trigger function
    CREATE OR REPLACE FUNCTION public.set_updated_at()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
      new.updated_at = now();
      RETURN new;
    END;
    $fn$;

    -- Create users table
    CREATE TABLE IF NOT EXISTS public.users (
      id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      email text NOT NULL UNIQUE,
      role public.user_role NOT NULL DEFAULT 'cashier',
      display_name text NOT NULL,
      phone text,
      is_active boolean NOT NULL DEFAULT true,
      failed_login_attempts integer NOT NULL DEFAULT 0,
      locked_until timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_users_role_active ON public.users(role, is_active);
    CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);

    -- Create trigger
    DROP TRIGGER IF EXISTS trg_users_set_updated_at ON public.users;
    CREATE TRIGGER trg_users_set_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

    -- Disable RLS on users for service role access
    ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

    -- Allow service role full access
    CREATE POLICY IF NOT EXISTS "Service role full access" ON public.users
      FOR ALL
      USING (true)
      WITH CHECK (true);
  `;

  const result = await runMigrationSql(migrationSQL);

  if (!result.ok) {
    console.error('❌  Could not auto-create the table via SQL API.');
    console.error(`    Error: ${result.error}`);
    console.error('\n📋  Please run this SQL manually in the Supabase SQL Editor:');
    console.error('    https://supabase.com/dashboard → SQL Editor → New query');
    console.error(
      '    Paste the contents of: supabase/migrations/001_create_auth_tables.sql'
    );
    console.error('    Then re-run: npm run seed\n');
    return false;
  }

  console.log('✅  Users table created successfully.');
  return true;
}

async function main() {
  console.log(`\n🔧  Seeding admin user: ${ADMIN_EMAIL}\n`);

  /* ── 1. Check if the user already exists in auth.users ── */
  const { data: existingUsers, error: listError } =
    await supabase.auth.admin.listUsers();

  if (listError) {
    console.error('❌  Failed to list users:', listError.message);
    process.exit(1);
  }

  const existing = existingUsers.users.find((u) => u.email === ADMIN_EMAIL);

  let userId: string;

  if (existing) {
    console.log('ℹ️   Auth user already exists – skipping creation.');
    userId = existing.id;
  } else {
    /* ── 2. Create auth user via Admin API ── */
    const { data: newUser, error: createError } =
      await supabase.auth.admin.createUser({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        email_confirm: true, // auto-confirm the email
        app_metadata: { role: 'admin' },
        user_metadata: { role: 'admin', display_name: ADMIN_DISPLAY_NAME },
      });

    if (createError) {
      console.error('❌  Failed to create auth user:', createError.message);
      process.exit(1);
    }

    userId = newUser.user.id;
    console.log('✅  Auth user created:', userId);
  }

  /* ── 3. Ensure public.users table exists ── */
  const tableReady = await ensureUsersTable();

  if (!tableReady) {
    console.log(
      '\n✅  Auth user was created successfully — only the public.users row is missing.'
    );
    console.log('    After creating the table, re-run: npm run seed\n');
    process.exit(1);
  }

  /* ── 4. Upsert into public.users ── */
  const { error: upsertError } = await supabase.from('users').upsert(
    {
      id: userId,
      email: ADMIN_EMAIL,
      role: 'admin',
      display_name: ADMIN_DISPLAY_NAME,
      is_active: true,
    },
    { onConflict: 'id' }
  );

  if (upsertError) {
    // If RLS is blocking, try via raw SQL
    console.log('⚠️   PostgREST upsert failed, trying via raw SQL...');

    const insertResult = await runMigrationSql(`
      INSERT INTO public.users (id, email, role, display_name, is_active)
      VALUES ('${userId}', '${ADMIN_EMAIL}', 'admin', '${ADMIN_DISPLAY_NAME}', true)
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        role = 'admin',
        display_name = EXCLUDED.display_name,
        is_active = true;
    `);

    if (!insertResult.ok) {
      console.error('❌  Failed to upsert public.users row:', upsertError.message);
      console.error('    SQL fallback also failed:', insertResult.error);
      process.exit(1);
    }
  }

  console.log('✅  public.users row upserted.');
  console.log('\n🎉  Admin seeding complete!');
  console.log(`    Email:    ${ADMIN_EMAIL}`);
  console.log(`    Password: ${ADMIN_PASSWORD}`);
  console.log(`    Role:     admin\n`);
}

main();
