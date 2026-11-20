import { NotificationBell } from '../../shared/ui/NotificationBell.jsx';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';
import { useAuth } from '../../shared/auth/hooks.js';
import { LanguageSwitcher } from '../../shared/i18n/LanguageSwitcher.jsx';
import { AppShell } from '../../shared/ui/AppShell.jsx';
import { UserMenu } from './SurfaceLayout.jsx';

const navigation = [
  { key: 'dashboard', to: '/app/dashboard', permission: 'reports.read' },
  { key: 'users', to: '/app/users', permission: 'org.user.read' },
  { key: 'organization', to: '/app/organization', permission: 'org.user.read' },
  { key: 'regions', to: '/app/regions', permission: 'org.pos.read', hiddenFor: 'supervisor' },
  { key: 'points', to: '/app/points-of-sale', permission: 'org.pos.read', hiddenFor: 'supervisor' },
  { key: 'clients', to: '/app/clients', permission: 'catalog.read' },
  { key: 'campaigns', to: '/app/campaigns', permission: 'campaign.read' },
  { key: 'attendance', to: '/app/attendance', permission: 'attendance.review' },
  { key: 'issues', to: '/app/issues', permission: 'issue.read' },
  { key: 'announcements', to: '/app/announcements', permission: 'announcement.read' },
  { key: 'myStock', to: '/app/my-stock', permission: 'inventory.transfer' },
  { key: 'approvals', to: '/app/approvals', permission: 'assignment.approve' },
];

/** Agency staff surface with organization and catalog navigation. */
export function AppLayout() {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  const items = navigation
    .filter((item) => item.hiddenFor !== user?.role)
    .map(({ hiddenFor: _hiddenFor, ...item }) => ({ ...item, label: t('admin.' + item.key) }));
  return (
    <AppShell
      title={t('appName')}
      items={items}
      topBar={
        <div className="flex min-w-0 items-center gap-3">
          <NotificationBell />
          <LanguageSwitcher />
          <UserMenu />
        </div>
      }
    >
      <Outlet />
    </AppShell>
  );
}
