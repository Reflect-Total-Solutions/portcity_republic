import LoginForm from '@/components/auth/LoginForm';

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const resolvedSearchParams = await searchParams;
  const nextParam = resolvedSearchParams.next;
  const redirectTo = Array.isArray(nextParam) ? nextParam[0] : nextParam;

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600">
        Port City Republic
      </p>
      <h1 className="mt-3 text-2xl font-semibold text-slate-900">System Login</h1>
      <p className="mt-2 text-sm text-slate-600">
        Sign in to access the system dashboard.
      </p>
      <LoginForm redirectTo={redirectTo} />
    </div>
  );
}
