import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';
import { useCan } from '../auth/hooks.js';

function NavigationItem({ item, onNavigate }) {
  const visible = useCan(item.permission);
  if (!visible) return null;
  return (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      className={({ isActive }) =>
        'block rounded-lg px-3 py-2 text-sm ' +
        (isActive ? 'bg-slate-900 text-white' : 'hover:bg-slate-100')
      }
    >
      {item.label}
    </NavLink>
  );
}

/** App frame with permission-aware navigation that collapses below 1024 px. */
export function AppShell({ title, topBar, items, children }) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation('common');
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex min-h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 lg:px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="rounded-md border px-2 py-1 lg:hidden"
            aria-expanded={open}
            aria-controls="admin-navigation"
            onClick={() => setOpen(!open)}
          >
            {t('admin.menu')}
          </button>
          <span className="text-lg font-semibold">{title}</span>
        </div>
        {topBar}
      </header>
      <div className="lg:flex">
        <aside
          id="admin-navigation"
          className={
            (open ? 'block' : 'hidden') +
            ' border-b border-slate-200 bg-white px-3 py-4 lg:block lg:w-56 lg:shrink-0 lg:border-e lg:border-b-0'
          }
        >
          <nav aria-label={t('admin.menu')} className="space-y-1">
            {items.map((item) => (
              <NavigationItem key={item.to} item={item} onNavigate={() => setOpen(false)} />
            ))}
          </nav>
        </aside>
        <main className="mx-auto min-w-0 max-w-7xl flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
