import { useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet, useMatch, useNavigate } from 'react-router';
import { LanguageSwitcher } from '../../shared/i18n/LanguageSwitcher.jsx';
import { usePortalQuery, usePortalText } from '../../surfaces/portal/api.js';
import { ThemeToggle } from '../../ui/controls.jsx';
import { LogoMark, SelectControl, Wordmark } from '../../ui/primitives.jsx';
import { applySurface } from '../../ui/theme.js';
import { UserMenu } from './SurfaceLayout.jsx';

/**
 * Client portal (/portal): calmer than the staff app. A brand-stripe band with the mark and the
 * session controls, then the client's name with a campaign switcher, then generous whitespace.
 */
export function PortalLayout() {
  const { t: common } = useTranslation('common');
  const { t } = usePortalText();
  const navigate = useNavigate();
  const campaigns = usePortalQuery('/portal/campaigns');
  const match = useMatch('/portal/campaigns/:id/*');
  useLayoutEffect(() => {
    applySurface('portal');
  }, []);
  const rows = campaigns.data ?? [];
  const client = rows[0]?.client?.name;
  return (
    <div className="flex min-h-screen flex-col bg-canvas text-fg">
      <header>
        <div data-theme="dark" className="brand-stripe h-28 text-fg">
          <div className="mx-auto flex max-w-6xl items-start justify-between gap-3 px-4 pt-3 lg:px-6">
            <Link to="/portal" className="flex items-center gap-2.5" aria-label={common('appName')}>
              <LogoMark size={32} />
              <Wordmark className="text-lg text-brand-white" />
              <span className="sr-only">{common('surfaces.portal')}</span>
            </Link>
            <div className="flex min-w-0 items-center gap-2">
              <LanguageSwitcher compact />
              <ThemeToggle />
              <UserMenu />
            </div>
          </div>
        </div>
        <div className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 lg:px-6">
            <div className="min-w-0">
              <p className="text-xs text-fg-3">{common('surfaces.portal')}</p>
              {client && (
                <p className="truncate text-lg font-semibold tracking-tight">
                  <bdi dir="auto">{client}</bdi>
                </p>
              )}
            </div>
            {rows.length > 1 && (
              <label className="flex items-center gap-2 text-sm text-fg-2">
                <span>{t('switchCampaign')}</span>
                <SelectControl
                  className="w-56"
                  value={match?.params.id ?? ''}
                  onChange={(event) =>
                    navigate(
                      event.target.value ? '/portal/campaigns/' + event.target.value : '/portal',
                    )
                  }
                >
                  <option value="">{t('allCampaigns')}</option>
                  {rows.map((campaign) => (
                    <option key={campaign.id} value={campaign.id}>
                      {campaign.name}
                    </option>
                  ))}
                </SelectControl>
              </label>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 lg:px-6">
        <Outlet />
      </main>
    </div>
  );
}
