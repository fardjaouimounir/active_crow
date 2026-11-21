import { can } from '@fieldflow/shared';
import { PanelLeftClose, PanelLeftOpen, Menu, Search } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, useLocation } from 'react-router';
import { useAuth } from '../auth/hooks.js';
import { Breadcrumbs } from '../../ui/data.jsx';
import { CrumbProvider, IconButton, ThemeToggle, useCrumbTail } from '../../ui/controls.jsx';
import { LogoMark, Wordmark, cn } from '../../ui/primitives.jsx';
import { CommandPalette } from './CommandPalette.jsx';
import { useNavCounts } from './useNavCounts.js';

const COLLAPSE_KEY = 'acticrew.sidebar';

function readCollapsed() {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === 'collapsed';
  } catch {
    return false;
  }
}

function NavigationItem({ item, collapsed, onNavigate, count }) {
  const { t: tp } = useTranslation('pro');
  const countId = useId();
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      aria-describedby={count > 0 ? countId : undefined}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        cn(
          'group relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors duration-[var(--dur-fast)]',
          isActive ? 'font-medium text-fg' : 'text-fg-2 hover:bg-sunken hover:text-fg',
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            aria-hidden="true"
            className={cn(
              'absolute inset-y-1 start-0 w-0.5 rounded-full bg-accent transition-opacity duration-[var(--dur-fast)]',
              isActive ? 'opacity-100' : 'opacity-0',
            )}
          />
          {Icon && (
            <Icon
              aria-hidden="true"
              size={16}
              strokeWidth={1.5}
              className={cn('shrink-0', isActive && 'text-accent-text')}
            />
          )}
          <span className={cn('truncate', collapsed && 'lg:sr-only')}>{item.label}</span>
          {count > 0 && (
            <span id={countId} className="sr-only">
              {count} {tp('shell.waiting')}
            </span>
          )}
          {count > 0 && (
            <span
              className={cn(
                'tnum ms-auto inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-soft px-1 text-2xs font-semibold text-accent-text',
                collapsed && 'lg:absolute lg:end-0.5 lg:top-0.5 lg:ms-0',
              )}
            >
              <span aria-hidden="true">{count > 99 ? '99+' : count}</span>
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

/** Section crumb from the first path segment plus an optional page-provided tail. */
function useBreadcrumbs(items) {
  const { t } = useTranslation('common');
  const { pathname } = useLocation();
  const tail = useCrumbTail();
  return useMemo(() => {
    const segments = pathname.split('/').filter(Boolean).slice(1);
    const section = items.find((item) => item.to === '/app/' + segments[0]);
    if (!section) return [];
    const crumbs = [{ label: section.label, to: segments.length > 1 ? section.to : undefined }];
    const last = segments.at(-1);
    if (segments.length > 1) {
      if (last === 'new') crumbs.push({ label: t('shell.new') });
      else if (tail) {
        crumbs.push({
          label: tail,
          to: last === 'report' ? pathname.replace(/\/report$/, '') : undefined,
        });
        if (last === 'report') crumbs.push({ label: t('admin.campaignReport') });
      }
    }
    return crumbs;
  }, [items, pathname, t, tail]);
}

function Frame({ groups, topBar, children }) {
  const { t } = useTranslation('common');
  const { t: tp } = useTranslation('pro');
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const visible = useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => !item.permission || can(user?.role, item.permission)),
        }))
        .filter((group) => group.items.length),
    [groups, user?.role],
  );
  const flat = visible.flatMap((group) => group.items);
  const crumbs = useBreadcrumbs(flat);
  const counts = useNavCounts();
  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');

  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    const onEscape = (event) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onEscape);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onEscape);
    };
  }, []);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(COLLAPSE_KEY, next ? 'collapsed' : 'expanded');
    } catch {
      /* session only */
    }
  }

  const CollapseIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <div className="h-dvh overflow-hidden bg-canvas text-fg print:h-auto print:overflow-visible">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-fg"
      >
        {t('ui.skip')}
      </a>
      {mobileOpen && (
        <button
          type="button"
          aria-label={t('admin.close')}
          tabIndex={-1}
          className="fixed inset-0 z-30 bg-scrim lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        id="admin-navigation"
        className={cn(
          'fixed inset-y-0 start-0 z-40 flex w-[var(--sidebar-w)] flex-col border-e border-line bg-canvas transition-transform duration-[var(--dur-slow)] ease-out lg:translate-x-0 rtl:lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : 'max-lg:invisible -translate-x-full rtl:translate-x-full',
          collapsed && 'lg:w-[var(--sidebar-w-collapsed)]',
        )}
      >
        <div className="flex h-[var(--topbar-h)] shrink-0 items-center border-b border-line px-2">
          <Link
            to="/app"
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1.5 py-1 hover:bg-sunken"
            aria-label={t('appName')}
          >
            <LogoMark size={26} />
            <span className={cn('min-w-0 leading-tight', collapsed && 'lg:sr-only')}>
              <Wordmark className="block truncate text-sm" />
              <span className="block truncate text-2xs text-fg-3">
                {tp('shell.workspace', { role: t('roles.' + user?.role) })}
              </span>
            </span>
          </Link>
        </div>
        <nav
          aria-label={t('admin.menu')}
          className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2 py-3"
        >
          {visible.map((group) => (
            <div key={group.key} role="group" aria-label={group.label} className="space-y-0.5">
              {/* Visual group label drawn by CSS: the group is named for assistive tech by aria-label, and
                  the label is not repeated as text next to a same-named link (e.g. Clients > Clients). */}
              <span
                aria-hidden="true"
                data-label={group.label}
                className={cn(
                  'block px-2.5 pb-1 text-2xs font-medium tracking-[0.08em] text-fg-3 uppercase before:content-[attr(data-label)]',
                  collapsed && 'lg:sr-only',
                )}
              />
              {group.items.map((item) => (
                <NavigationItem
                  key={item.to}
                  item={item}
                  collapsed={collapsed}
                  count={counts[item.to]}
                  onNavigate={() => setMobileOpen(false)}
                />
              ))}
            </div>
          ))}
        </nav>
        <div className="hidden shrink-0 border-t border-line p-2 lg:block">
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={t(collapsed ? 'ui.sidebar.expand' : 'ui.sidebar.collapse')}
            title={t(collapsed ? 'ui.sidebar.expand' : 'ui.sidebar.collapse')}
            className="flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-sm text-fg-3 hover:bg-sunken hover:text-fg"
          >
            <CollapseIcon
              aria-hidden="true"
              size={16}
              strokeWidth={1.5}
              className="rtl:-scale-x-100"
            />
            <span className={cn(collapsed && 'sr-only')}>{t('ui.sidebar.collapse')}</span>
          </button>
        </div>
      </aside>

      <div
        className={cn(
          'flex h-dvh min-w-0 flex-col print:block print:h-auto',
          collapsed ? 'lg:ps-[var(--sidebar-w-collapsed)]' : 'lg:ps-[var(--sidebar-w)]',
        )}
      >
        <header className="z-20 flex h-[var(--topbar-h)] shrink-0 items-center gap-3 border-b border-line bg-canvas px-3 lg:px-6 print:hidden">
          <IconButton
            label={t('admin.menu')}
            aria-expanded={mobileOpen}
            aria-controls="admin-navigation"
            className="lg:hidden"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            <Menu aria-hidden="true" size={18} strokeWidth={1.5} />
          </IconButton>
          <div className="min-w-0 flex-1">
            <Breadcrumbs items={crumbs} label={t('shell.breadcrumbs')} />
          </div>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label={t('shell.openSearch')}
            aria-keyshortcuts="Control+K Meta+K"
            className="inline-flex h-8 items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-sm text-fg-3 hover:border-line-strong hover:text-fg sm:min-w-52"
          >
            <Search aria-hidden="true" size={14} strokeWidth={1.5} />
            <span className="hidden flex-1 text-start sm:inline">{t('shell.openSearch')}</span>
            <kbd
              className="hidden rounded border border-line px-1 font-sans text-2xs sm:inline"
              dir="ltr"
            >
              {isMac ? '⌘K' : 'Ctrl K'}
            </kbd>
          </button>
          <div className="flex shrink-0 items-center gap-1">
            {topBar}
            <ThemeToggle />
          </div>
        </header>
        <div className="min-h-0 flex-1 scroll-pt-16 overflow-y-auto overscroll-contain print:overflow-visible">
          <main
            id="main"
            tabIndex={-1}
            className="mx-auto min-w-0 max-w-[88rem] px-4 pt-6 pb-12 outline-none lg:px-8"
          >
            {children}
          </main>
        </div>
      </div>
      {paletteOpen && (
        <CommandPalette
          pages={flat.map((item) => ({ label: item.label, to: item.to }))}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * Staff app frame: grouped, permission-aware sidebar (collapsible; off-canvas below 1024 px),
 * top bar with breadcrumbs, command palette, and the controls passed in `topBar`.
 * `groups` = [{ key, label, items: [{ to, label, icon, permission }] }].
 */
export function AppShell({ groups, topBar, children }) {
  return (
    <CrumbProvider>
      <Frame groups={groups} topBar={topBar}>
        {children}
      </Frame>
    </CrumbProvider>
  );
}
