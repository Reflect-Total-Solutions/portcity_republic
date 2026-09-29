import LogoutButton from '@/components/auth/LogoutButton';

export default function LogoutPage() {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600">
        Port City Republic
      </p>
      <h1 className="mt-3 text-2xl font-semibold text-slate-900">Sign Out</h1>
      <p className="mt-2 text-sm text-slate-600">
        End your current POS session securely.
      </p>
      <div className="mt-6">
        <LogoutButton />
      </div>
    </div>
  );
}
