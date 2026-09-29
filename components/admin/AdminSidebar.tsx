'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import {
  LayoutDashboard,
  Users,
  Activity,
  FolderTree,
  BadgeDollarSign,
  LineChart,
  ClipboardList,
  Settings,
  Store,
  LogOut,
  Undo2,
} from 'lucide-react';

const adminLinks = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/activities', label: 'Activities', icon: Activity },
  { href: '/admin/categories', label: 'Categories', icon: FolderTree },
  { href: '/admin/pricing', label: 'Pricing', icon: BadgeDollarSign },
  { href: '/admin/reports', label: 'Reports', icon: LineChart },
  { href: '/admin/refund', label: 'Refund', icon: Undo2 },
  { href: '/admin/audit-log', label: 'Audit Log', icon: ClipboardList },
  { href: '/admin/maintenance', label: 'Maintenance', icon: Settings },
];

export default function AdminSidebar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const isVendor = user?.role === 'vendor';

  const visibleLinks = isVendor 
    ? [
        { href: '/admin/vendor', label: 'Dashboard', icon: LayoutDashboard },
        { href: '/admin/vendor/reports', label: 'Reports', icon: LineChart }
      ]
    : adminLinks;

  return (
    <aside className="w-full lg:w-64 bg-white border border-slate-200 text-slate-800 rounded-[1.25rem] p-5 shadow-sm h-fit lg:sticky lg:top-8">
      <div className="mb-6 px-1">
        <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 mb-0.5">Port City Republic</p>
        <h2 className="text-xl font-bold tracking-tight text-slate-900 mb-1">
          {isVendor ? 'Vendor Panel' : 'Admin Panel'}
        </h2>
        <p className="text-xs font-medium text-slate-500">Management & Operations</p>
      </div>

      <nav className="space-y-1">
        {visibleLinks.map((link) => {
          const isActive = pathname === link.href || (link.href !== '/admin' && pathname.startsWith(link.href));
          const Icon = link.icon;
          
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                isActive
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Icon className={`w-[18px] h-[18px] ${isActive ? 'text-slate-200' : 'text-slate-500'}`} strokeWidth={2.5} />
              <span>{link.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-8 border-t border-slate-100 pt-5">
        <Link
          href="/logout"
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-700 transition-all duration-200 group"
        >
          <LogOut className="w-[18px] h-[18px] text-slate-400 group-hover:text-red-500" strokeWidth={2.5} />
          <span>Sign Out</span>
        </Link>
      </div>
    </aside>
  );
}
