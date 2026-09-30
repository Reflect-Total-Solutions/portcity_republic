const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://lkegomvftatwuknsrbfg.supabase.co',
  'sb_secret_upeCFAlM3LUXm6pjq-a-Gg_PYJOyQcY',
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function cleanAndCreate() {
  const email = 'adminnew1@gmail.com';
  const password = '123123123';

  // Step 1: Clean up broken records via SQL using rpc or direct query
  console.log('Cleaning up broken records...');
  
  // Delete from public.users first (has FK to auth.users)
  const { error: pubErr } = await supabase.from('users').delete().eq('email', email);
  if (pubErr) console.log('public.users cleanup:', pubErr.message);
  else console.log('public.users cleaned');

  // Delete from auth tables via admin API - list all users and find the one
  const { data: listData, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) {
    console.log('List users error:', listErr.message);
  } else {
    const found = listData.users.filter(u => u.email === email);
    for (const u of found) {
      console.log('Deleting auth user:', u.id);
      const { error: delErr } = await supabase.auth.admin.deleteUser(u.id);
      if (delErr) console.log('Delete error:', delErr.message);
      else console.log('Deleted auth user:', u.id);
    }
  }

  // Wait a moment for cleanup to propagate
  await new Promise(r => setTimeout(r, 2000));

  // Step 2: Create user fresh
  console.log('\nCreating new admin user...');
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: 'Admin New' }
  });

  if (error) {
    console.error('Error creating auth user:', error.message);
    return;
  }

  console.log('Auth user created:', data.user.id);

  // Step 3: Insert into public.users
  const { error: dbError } = await supabase
    .from('users')
    .insert({
      id: data.user.id,
      email,
      role: 'admin',
      display_name: 'Admin New',
      is_active: true
    });

  if (dbError) {
    console.error('Error inserting public.users:', dbError.message);
    return;
  }

  console.log('\n✅ Admin user created successfully!');
  console.log('Email:', email);
  console.log('Password:', password);
  console.log('Role: admin');
}

cleanAndCreate().catch(console.error);
