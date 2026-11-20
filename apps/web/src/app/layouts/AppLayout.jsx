import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';
import { useAuth } from '../../shared/auth/hooks.js';
import { LanguageSwitcher } from '../../shared/i18n/LanguageSwitcher.jsx';
import { AppShell } from '../../shared/ui/AppShell.jsx';
import { UserMenu } from './SurfaceLayout.jsx';

const organizationNavigation = [
  { key: 'users', to: '/app/users', permission: 'org.user.read' },
  { key: 'organization', to: '/app/organization', permission: 'org.user.read' },
  { key: 'regions', to: '/app/regions', permission: 'org.pos.read' },
  { key: 'points', to: '/app/points-of-sale', permission: 'org.pos.read' },
];

/** Agency staff surface with organization navigation. */
export function AppLayout() {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  const items = (
    user?.role === 'supervisor' ? organizationNavigation.slice(0, 2) : organizationNavigation
  ).map((item) => ({ ...item, label: t('admin.' + item.key) }));
  return (
    <AppShell
      title={t('appName')}
      items={items}
      topBar={
        <div className="flex min-w-0 items-center gap-3">
          <LanguageSwitcher />
          <UserMenu />
        </div>
      }
    >
      <Outlet />
    </AppShell>
  );
}
