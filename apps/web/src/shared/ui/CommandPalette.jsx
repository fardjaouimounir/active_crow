import { CornerDownLeft, FileText, Megaphone, Search, Store, User } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useCampaignResource } from '../../features/campaigns/api.js';
import { useOrganizationResource } from '../../features/organization/api.js';
import { useCan } from '../auth/hooks.js';
import { cn } from '../../ui/primitives.jsx';
import { messages } from './paletteMessages.js';

/** Debounces a fast-changing value (typing) before it reaches the API. */
function useDebounced(value, delay = 200) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

const ICONS = { pages: FileText, campaigns: Megaphone, stores: Store, users: User };

/**
 * Ctrl/⌘ + K palette: jumps to a page, campaign, store or person. It only uses the existing scoped
 * list endpoints (`q` search, 5 rows each), so it can never show more than the user's lists do.
 * Combobox pattern: the input keeps focus, arrows move `aria-activedescendant`.
 */
export function CommandPalette({ pages, onClose }) {
  const { t, i18n } = useTranslation('common');
  const arabic = (i18n.resolvedLanguage ?? 'en').startsWith('ar');
  const tp = (key, values = {}) =>
    Object.entries(values).reduce(
      (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
      messages[key][arabic ? 1 : 0],
    );
  const navigate = useNavigate();
  const dialog = useRef(null);
  const listId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const q = useDebounced(query.trim());
  const searching = q.length >= 2;
  const canCampaigns = useCan('campaign.read');
  const canStores = useCan('org.pos.read');
  const canUsers = useCan('org.user.read');
  const params = { q, pageSize: 5 };
  const campaigns = useCampaignResource('/campaigns', params, {
    enabled: searching && canCampaigns,
  });
  const stores = useOrganizationResource('/points-of-sale', params, {
    enabled: searching && canStores && pages.some((page) => page.to === '/app/points-of-sale'),
  });
  const users = useOrganizationResource('/users', params, { enabled: searching && canUsers });

  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);

  const groups = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(i18n.resolvedLanguage);
    const matchingPages = pages
      .filter(
        (page) => !needle || page.label.toLocaleLowerCase(i18n.resolvedLanguage).includes(needle),
      )
      .map((page) => ({ id: 'page-' + page.to, label: page.label, to: page.to }));
    return [
      { key: 'pages', items: matchingPages },
      {
        key: 'campaigns',
        items: (campaigns.data?.data ?? []).map((row) => ({
          id: 'campaign-' + row.id,
          label: row.name,
          hint: row.client?.name,
          to: '/app/campaigns/' + row.id,
        })),
      },
      {
        key: 'stores',
        items: (stores.data?.data ?? []).map((row) => ({
          id: 'store-' + row.id,
          label: row.name,
          hint: row.code,
          to: '/app/points-of-sale/' + row.id,
        })),
      },
      {
        key: 'users',
        items: (users.data?.data ?? []).map((row) => ({
          id: 'user-' + row.id,
          label: row.fullName,
          hint: t('roles.' + row.role),
          to: '/app/users/' + row.id,
        })),
      },
    ].filter((group) => group.items.length);
  }, [pages, query, campaigns.data, stores.data, users.data, i18n.resolvedLanguage, t]);

  const flat = groups.flatMap((group) => group.items);
  const current = flat[Math.min(active, flat.length - 1)];
  const pending = searching && (campaigns.isFetching || stores.isFetching || users.isFetching);

  function open(item) {
    onClose();
    navigate(item.to);
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!flat.length) return;
      setActive(
        (value) => (value + (event.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length,
      );
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'Enter' && current) {
      event.preventDefault();
      open(current);
    }
  }

  useEffect(() => {
    document.getElementById(listId + '-' + current?.id)?.scrollIntoView?.({ block: 'nearest' });
  }, [current?.id, listId]);

  return (
    <dialog
      ref={dialog}
      aria-label={tp('title')}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      className="m-0 mx-auto mt-[12vh] w-[min(36rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-line bg-raised p-0 text-fg shadow-xl"
    >
      <div className="flex items-center gap-2 border-b border-line px-3">
        <Search aria-hidden="true" size={16} strokeWidth={1.5} className="shrink-0 text-fg-3" />
        <input
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={current ? listId + '-' + current.id : undefined}
          aria-label={tp('title')}
          autoFocus
          autoComplete="off"
          value={query}
          placeholder={tp('placeholder')}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="h-12 min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-3"
        />
      </div>
      <div
        id={listId}
        role="listbox"
        aria-label={tp('title')}
        className="max-h-[50vh] overflow-y-auto p-1.5"
      >
        {groups.map((group) => {
          const Icon = ICONS[group.key];
          return (
            <div key={group.key} role="group" aria-label={tp(group.key)}>
              <p className="px-2 pt-2 pb-1 text-2xs font-medium tracking-wide text-fg-3 uppercase">
                {tp(group.key)}
              </p>
              {group.items.map((item) => {
                const selected = item.id === current?.id;
                return (
                  <div
                    key={item.id}
                    id={listId + '-' + item.id}
                    role="option"
                    aria-selected={selected}
                    onMouseMove={() => setActive(flat.indexOf(item))}
                    onClick={() => open(item)}
                    className={cn(
                      'flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-sm',
                      selected ? 'bg-accent-soft text-fg' : 'text-fg-2',
                    )}
                  >
                    <Icon
                      aria-hidden="true"
                      size={16}
                      strokeWidth={1.5}
                      className={selected ? 'text-accent-text' : 'text-fg-3'}
                    />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.hint && <span className="shrink-0 text-xs text-fg-3">{item.hint}</span>}
                    {selected && (
                      <CornerDownLeft
                        aria-hidden="true"
                        size={14}
                        className="shrink-0 text-fg-3 rtl:-scale-x-100"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
        {!flat.length && (
          <p role="status" className="px-3 py-6 text-center text-sm text-fg-2">
            {pending ? tp('loading') : tp('empty')}
          </p>
        )}
      </div>
      <p className="border-t border-line px-3 py-2 text-xs text-fg-3" aria-live="polite">
        {flat.length ? tp('results', { count: flat.length }) + ' · ' : ''}
        {tp('hint')}
      </p>
    </dialog>
  );
}
