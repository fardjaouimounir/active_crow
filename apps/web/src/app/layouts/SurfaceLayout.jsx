import { LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLogoutMutation } from '../../features/auth/api.js';
import { useAuth } from '../../shared/auth/hooks.js';
import { IconButton } from '../../ui/controls.jsx';
import { Avatar } from '../../ui/primitives.jsx';

/** Signed-in user's avatar, name, translated role and the sign-out button. */
export function UserMenu() {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  // After logout the surface guard sends the user to /login.
  const logout = useLogoutMutation();

  if (!user) return null;
  return (
    <div aria-label={t('user.label')} role="group" className="flex min-w-0 items-center gap-2">
      <Avatar name={user.fullName} size="md" />
      <div className="hidden min-w-0 text-start leading-tight md:block">
        <p className="truncate text-sm font-medium text-fg">{user.fullName}</p>
        <p className="truncate text-xs text-fg-3">{t(`roles.${user.role}`)}</p>
      </div>
      <IconButton
        label={t('actions.logout')}
        disabled={logout.isPending}
        onClick={() => logout.mutate()}
        className="disabled:opacity-60"
      >
        <LogOut aria-hidden="true" size={16} strokeWidth={1.5} className="rtl:-scale-x-100" />
      </IconButton>
    </div>
  );
}
