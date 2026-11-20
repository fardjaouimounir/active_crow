import {
  Activity,
  Building2,
  CheckCheck,
  CircleAlert,
  ClipboardCheck,
  LayoutDashboard,
  Map,
  Megaphone,
  Network,
  Package,
  ScanSearch,
  Store,
  Target,
  Users,
} from 'lucide-react';
import { useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';
import { useAuth } from '../../shared/auth/hooks.js';
import { LanguageSwitcher } from '../../shared/i18n/LanguageSwitcher.jsx';
import { AppShell } from '../../shared/ui/AppShell.jsx';
import { NotificationBell } from '../../shared/ui/NotificationBell.jsx';
import { applySurface } from '../../ui/theme.js';
import { UserMenu } from './SurfaceLayout.jsx';

/**
 * Sidebar model. `permission` hides an entry the role cannot use (the API stays the authority);
 * `hiddenFor` keeps the supervisor's reduced network menu.
 */
const navigation = [
  {
    group: 'overview',
    key: 'dashboard',
    to: '/app/dashboard',
    permission: 'reports.read',
    icon: LayoutDashboard,
  },
  {
    group: 'campaigns',
    key: 'campaigns',
    to: '/app/campaigns',
    permission: 'campaign.read',
    icon: Target,
  },
  {
    group: 'campaigns',
    key: 'approvals',
    to: '/app/approvals',
    permission: 'assignment.approve',
    icon: CheckCheck,
  },
  {
    group: 'fieldOps',
    key: 'attendance',
    to: '/app/attendance',
    permission: 'attendance.review',
    icon: ClipboardCheck,
  },
  {
    group: 'fieldOps',
    key: 'issues',
    to: '/app/issues',
    permission: 'issue.read',
    icon: CircleAlert,
  },
  {
    group: 'fieldOps',
    key: 'announcements',
    to: '/app/announcements',
    permission: 'announcement.read',
    icon: Megaphone,
  },
  {
    group: 'stock',
    key: 'myStock',
    to: '/app/my-stock',
    permission: 'inventory.transfer',
    icon: Package,
  },
  { group: 'people', key: 'users', to: '/app/users', permission: 'org.user.read', icon: Users },
  {
    group: 'people',
    key: 'organization',
    to: '/app/organization',
    permission: 'org.user.read',
    icon: Network,
  },
  {
    group: 'people',
    key: 'regions',
    to: '/app/regions',
    permission: 'org.pos.read',
    hiddenFor: 'supervisor',
    icon: Map,
  },
  {
    group: 'people',
    key: 'points',
    to: '/app/points-of-sale',
    permission: 'org.pos.read',
    hiddenFor: 'supervisor',
    icon: Store,
  },
  {
    group: 'clients',
    key: 'clients',
    to: '/app/clients',
    permission: 'catalog.read',
    icon: Building2,
  },
  { group: 'ai', key: 'aiReview', to: '/app/ai-review', permission: 'ai.review', icon: ScanSearch },
  { group: 'settings', key: 'status', to: '/app', end: true, icon: Activity },
];
const GROUPS = [
  'overview',
  'campaigns',
  'fieldOps',
  'stock',
  'people',
  'clients',
  'ai',
  'settings',
];

/** Agency staff surface: grouped sidebar, breadcrumbs, command palette, theme and language. */
export function AppLayout() {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  // Before paint, so the surface never flashes the wrong theme.
  useLayoutEffect(() => applySurface('app'), []);
  const label = (item) => (item.key === 'status' ? t('shell.status') : t('admin.' + item.key));
  const items = navigation.filter((item) => item.hiddenFor !== user?.role);
  const groups = GROUPS.map((group) => ({
    key: group,
    label: t('shell.groups.' + group),
    items: items
      .filter((item) => item.group === group)
      .map(({ hiddenFor: _hiddenFor, group: _group, ...item }) => ({
        ...item,
        label: label(item),
      })),
  }));
  return (
    <AppShell
      groups={groups}
      topBar={
        <div className="flex min-w-0 items-center gap-2">
          <NotificationBell />
          <LanguageSwitcher compact />
          <UserMenu />
        </div>
      }
    >
      <Outlet />
    </AppShell>
  );
}
