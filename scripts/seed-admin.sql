-- Port City Republic - Seed Admin User
-- Run this in Supabase SQL Editor after running all-migrations.sql

-- Step 1: Insert into auth.users (Supabase managed auth table)
INSERT INTO auth.users (
  id,
  instance_id,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  role,
  aud,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token
) VALUES (
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000000',
  'admin@gmail.com',
  crypt('admin@123', gen_salt('bf')),
  now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  '{"display_name": "Admin"}'::jsonb,
  'authenticated',
  'authenticated',
  now(),
  now(),
  '',
  ''
);

-- Step 2: Insert into public.users with admin role
INSERT INTO public.users (
  id,
  email,
  role,
  display_name,
  is_active
) VALUES (
  (SELECT id FROM auth.users WHERE email = 'admin@gmail.com'),
  'admin@gmail.com',
  'admin',
  'Admin',
  true
);

-- Step 3: Create identity record (required for email/password login)
INSERT INTO auth.identities (
  id,
  user_id,
  provider_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
) VALUES (
  gen_random_uuid(),
  (SELECT id FROM auth.users WHERE email = 'admin@gmail.com'),
  'admin@gmail.com',
  jsonb_build_object(
    'sub', (SELECT id::text FROM auth.users WHERE email = 'admin@gmail.com'),
    'email', 'admin@gmail.com',
    'email_verified', true
  ),
  'email',
  now(),
  now(),
  now()
);
