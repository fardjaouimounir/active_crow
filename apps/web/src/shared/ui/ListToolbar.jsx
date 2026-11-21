import { Columns3, Search, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover } from '../../ui/overlays.jsx';
import { Button, cn } from '../../ui/primitives.jsx';

const chip =
  'inline-flex h-8 items-center gap-1.5 rounded-md border pe-1 ps-2.5 text-sm transition-colors duration-150';

/** Search box with an icon; the label stays available to assistive technology. */
function SearchBox({ label, value, onChange }) {
  return (
    <label className="relative inline-flex">
      <span className="sr-only">{label}</span>
      <Search
        aria-hidden="true"
        size={14}
        className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-fg-3"
      />
      <input
        type="search"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        placeholder={label}
        className="h-8 w-56 rounded-md border border-control bg-surface ps-8 pe-2.5 text-sm text-fg hover:border-fg-3 focus:border-focus"
      />
    </label>
  );
}

/**
 * One filter as a chip: a native select (so keyboard, mobile pickers and labels just work) that
 * turns accent when a value is chosen, with a clear button.
 */
function FilterChip({ name, label, value, options, onChange }) {
  const { t } = useTranslation('pro');
  const active = value != null && value !== '';
  const selected = options.find((option) => String(option.value) === String(value));
  return (
    <span
      className={cn(
        chip,
        active ? 'border-accent-line bg-accent-soft text-accent-text' : 'border-control bg-surface',
      )}
    >
      <label className="inline-flex items-center gap-1.5">
        <span className={cn('text-xs', active ? 'text-accent-text' : 'text-fg-3')}>{label}</span>
        <span className="relative inline-flex">
          <span className="font-medium">{selected?.label ?? t('list.all')}</span>
          <select
            name={name}
            aria-label={label}
            value={value ?? ''}
            onChange={(event) => onChange(event.target.value)}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          >
            <option value="">{t('list.all')}</option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </span>
      </label>
      {active ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={t('list.clear', { name: label })}
          className="inline-flex size-6 items-center justify-center rounded text-accent-text hover:bg-accent-line/40"
        >
          <X aria-hidden="true" size={12} />
        </button>
      ) : (
        <span aria-hidden="true" className="w-1.5" />
      )}
    </span>
  );
}

const STORAGE = 'acticrew.columns.';

/** Column visibility remembered per table (this browser only). */
export function useColumnVisibility(tableId) {
  const [hidden, setHidden] = useState(() => {
    try {
      return new Set(JSON.parse(window.localStorage.getItem(STORAGE + tableId) ?? '[]'));
    } catch {
      return new Set();
    }
  });
  const toggle = (id) =>
    setHidden((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        window.localStorage.setItem(STORAGE + tableId, JSON.stringify([...next]));
      } catch {
        /* session only */
      }
      return next;
    });
  return { hidden, toggle };
}

function ColumnsMenu({ columns, hidden, onToggle }) {
  const { t } = useTranslation('pro');
  return (
    <Popover
      align="end"
      label={t('list.columns')}
      trigger={
        <Button size="sm" variant="secondary">
          <Columns3 aria-hidden="true" size={14} />
          {t('list.columns')}
        </Button>
      }
    >
      <fieldset className="grid gap-0.5 p-1">
        <legend className="sr-only">{t('list.columns')}</legend>
        {columns.map((column) => (
          <label
            key={column.id}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sunken"
          >
            <input
              type="checkbox"
              checked={!hidden.has(column.id)}
              onChange={() => onToggle(column.id)}
            />
            {column.label}
          </label>
        ))}
      </fieldset>
    </Popover>
  );
}

/**
 * Toolbar above a list: search, filter chips, extra controls (dates…) and the column picker.
 * `filters` = [{ name, label, value, options: [{ value, label }], onChange }].
 */
export function ListToolbar({ search, filters = [], columns, children, actions }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {search && <SearchBox {...search} />}
      {filters.map((filter) => (
        <FilterChip key={filter.name} {...filter} />
      ))}
      {children}
      <div className="ms-auto flex items-center gap-2">
        {actions}
        {columns && (
          <ColumnsMenu columns={columns.all} hidden={columns.hidden} onToggle={columns.toggle} />
        )}
      </div>
    </div>
  );
}
