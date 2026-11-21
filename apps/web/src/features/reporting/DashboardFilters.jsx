import { today } from '@fieldflow/shared';
import { ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { buttonClass, controlClass } from '../../ui/primitives.jsx';
import { useReportingText } from './ReportingUi.jsx';

const primary = ['campaignIds', 'wilayaIds', 'supervisorIds'];
const secondary = ['clientId', 'regionIds', 'pointOfSaleIds', 'animateurIds'];
const button = buttonClass({ variant: 'secondary', size: 'sm' });
const shift = (day, days) =>
  new Date(Date.parse(day) + days * 86_400_000).toISOString().slice(0, 10);
export const monday = (day) => shift(day, -((new Date(day).getUTCDay() + 6) % 7));
const idsOf = (value) => value?.split(',').filter(Boolean) ?? [];
const DismissPopover = createContext(null);

function Popover({ label, open, toggle, close, children }) {
  const ref = useRef(null);
  const trigger = useRef(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    ref.current.querySelector('[data-initial-focus]')?.focus();
    const dismiss = (event) => {
      if (!ref.current.contains(event.target)) close();
    };
    const escape = (event) => {
      if (event.key !== 'Escape') return;
      if (event.target !== document.body && !ref.current.contains(event.target)) return;
      close();
      trigger.current.focus();
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open, close]);
  const dismiss = () => {
    close();
    trigger.current.focus();
  };
  return (
    <div ref={ref} className="sm:relative">
      <button
        ref={trigger}
        type="button"
        className={button}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={toggle}
      >
        {label}
        <ChevronDown aria-hidden="true" size={14} />
      </button>
      {open && (
        <div
          id={id}
          className="absolute start-0 top-full z-10 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface p-2 shadow-lg"
        >
          <DismissPopover value={dismiss}>{children}</DismissPopover>
        </div>
      )}
    </div>
  );
}

function FilterOptions({ name, selected, options, update }) {
  const { t, rtl } = useReportingText();
  const [query, setQuery] = useState('');
  const multi = name !== 'clientId';
  const visible = options.filter(({ label }) =>
    label
      .toLocaleLowerCase(rtl ? 'ar' : 'en')
      .includes(query.trim().toLocaleLowerCase(rtl ? 'ar' : 'en')),
  );
  return (
    <>
      <input
        type="search"
        aria-label={t('searchOptions', { filter: t(name) })}
        placeholder={t('search')}
        value={query}
        data-initial-focus
        onChange={(event) => setQuery(event.target.value)}
        className={controlClass}
      />
      <fieldset aria-label={t(name)} className="mt-1 max-h-52 overflow-y-auto">
        {visible.map(({ id, label }) => (
          <label
            key={id}
            className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-2 text-sm hover:bg-sunken"
          >
            <input
              type={multi ? 'checkbox' : 'radio'}
              name={name}
              checked={selected.includes(id)}
              onChange={() =>
                update({
                  [name]: multi
                    ? (selected.includes(id)
                        ? selected.filter((value) => value !== id)
                        : [...selected, id]
                      ).join(',')
                    : id,
                })
              }
            />
            <span className="break-words">{label}</span>
          </label>
        ))}
        {!visible.length && <p className="p-2 text-sm text-fg-3">{t('noOptions')}</p>}
      </fieldset>
    </>
  );
}

function CalendarRange({ raw, campaigns, update }) {
  const { t, rtl, language } = useReportingText();
  const dismiss = useContext(DismissPopover);
  const now = today();
  const [month, setMonth] = useState(() => {
    const day = [raw.from, raw.to, now].find(
      (value) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') && Number.isFinite(Date.parse(value)),
    );
    return day.slice(0, 7) + '-01';
  });
  const [start, setStart] = useState(null);
  const [focusedDay, setFocusedDay] = useState(() =>
    raw.from?.startsWith(month.slice(0, 7)) ? raw.from : now,
  );
  const locale = rtl ? 'ar-DZ' : language;
  const dateFormat = (options) => new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options });
  const dateLabel = dateFormat({ dateStyle: 'full' });
  const monthLabel = dateFormat({ month: 'long', year: 'numeric' });
  const weekdayLabel = dateFormat({ weekday: 'narrow' });
  const number = new Intl.NumberFormat(locale);
  const startOfGrid = monday(month);
  const tabDay =
    focusedDay >= startOfGrid && focusedDay <= shift(startOfGrid, 41) ? focusedDay : month;
  const nextMonth = (offset) => {
    const date = new Date(month);
    date.setUTCMonth(date.getUTCMonth() + offset);
    setMonth(date.toISOString().slice(0, 10));
  };
  const apply = (from, to) => {
    update({ from, to });
    dismiss();
  };
  const moveDay = (event, day) => {
    const delta = { ArrowLeft: rtl ? 1 : -1, ArrowRight: rtl ? -1 : 1, ArrowUp: -7, ArrowDown: 7 }[
      event.key
    ];
    if (!delta) return;
    const target = event.currentTarget.parentElement.querySelector(
      '[data-day="' + shift(day, delta) + '"]',
    );
    if (target) {
      event.preventDefault();
      target.focus();
    }
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        <button type="button" className={button} data-initial-focus onClick={() => apply(now, now)}>
          {t('today')}
        </button>
        <button type="button" className={button} onClick={() => apply(monday(now), now)}>
          {t('week')}
        </button>
        <button
          type="button"
          className={button}
          disabled={!campaigns.length}
          onClick={() =>
            apply(
              campaigns.map(({ startDate }) => startDate.slice(0, 10)).sort()[0],
              campaigns
                .map(({ endDate }) => endDate.slice(0, 10))
                .sort()
                .at(-1),
            )
          }
        >
          {t('period')}
        </button>
      </div>
      <div className="flex items-center justify-between text-sm">
        <button
          type="button"
          className={button}
          aria-label={t('previousMonth')}
          onClick={() => nextMonth(-1)}
        >
          <ChevronLeft size={14} aria-hidden="true" className="rtl:rotate-180" />
        </button>
        <span aria-live="polite">{monthLabel.format(new Date(month))}</span>
        <button
          type="button"
          className={button}
          aria-label={t('nextMonth')}
          onClick={() => nextMonth(1)}
        >
          <ChevronRight size={14} aria-hidden="true" className="rtl:rotate-180" />
        </button>
      </div>
      <p className="text-xs text-fg-2" aria-live="polite">
        {t(start ? 'chooseEnd' : 'chooseStart')}
      </p>
      <div className="grid grid-cols-7 text-center text-xs">
        {Array.from({ length: 7 }, (_, index) => (
          <span key={index} className="py-1 text-fg-3">
            {weekdayLabel.format(new Date(shift(startOfGrid, index)))}
          </span>
        ))}
        {Array.from({ length: 42 }, (_, index) => {
          const day = shift(startOfGrid, index);
          const inRange = start ? day === start : day >= (raw.from ?? '') && day <= (raw.to ?? '');
          return (
            <button
              key={day}
              type="button"
              data-day={day}
              aria-label={dateLabel.format(new Date(day))}
              aria-pressed={inRange}
              aria-current={day === now ? 'date' : undefined}
              tabIndex={day === tabDay ? 0 : -1}
              className={
                'h-8 rounded hover:bg-sunken ' +
                (inRange
                  ? 'bg-accent text-accent-fg hover:text-fg'
                  : day.slice(0, 7) === month.slice(0, 7)
                    ? ''
                    : 'text-fg-3')
              }
              onKeyDown={(event) => moveDay(event, day)}
              onFocus={() => setFocusedDay(day)}
              onClick={() => {
                if (!start) setStart(day);
                else apply(...[start, day].sort());
              }}
            >
              {number.format(Number(day.slice(8)))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DashboardFilters({ raw, update, options, period }) {
  const { t, rtl } = useReportingText();
  const [open, setOpen] = useState(null);
  const [more, setMore] = useState(false);
  const close = useCallback(() => setOpen(null), []);
  const names = [...primary, ...secondary];
  const entries = Object.fromEntries(
    names.map((name) => {
      const choices = (options?.[name] ?? []).map(
        ({ id, name: label, fullName, nameEn, nameAr }) => ({
          id: String(id),
          label: (rtl && nameAr) || label || fullName || nameEn || String(id),
        }),
      );
      for (const id of idsOf(raw[name])) {
        if (!choices.some((choice) => choice.id === id)) choices.push({ id, label: id });
      }
      return [name, choices];
    }),
  );
  const popover = (name, label, children) => (
    <Popover
      key={name}
      label={label}
      open={open === name}
      toggle={() => setOpen(open === name ? null : name)}
      close={close}
    >
      {children}
    </Popover>
  );
  const filter = (name) =>
    popover(
      name,
      t(name),
      <FilterOptions
        name={name}
        selected={idsOf(raw[name])}
        options={entries[name]}
        update={update}
      />,
    );
  const campaigns = (options?.campaignIds ?? []).filter(
    ({ id, startDate, endDate }) => idsOf(raw.campaignIds).includes(id) && startDate && endDate,
  );
  const from = raw.from ?? period?.from;
  const to = raw.to ?? period?.to;
  const dateLabel =
    from && to ? (
      <>
        <span className="sr-only">{t('dateRange')} </span>
        <bdi>
          {from} – {to}
        </bdi>
      </>
    ) : (
      t('dateRange')
    );
  return (
    <section
      aria-label={t('filters')}
      className="space-y-2 rounded-lg border border-line bg-surface p-2"
    >
      <div className="relative flex flex-wrap items-center gap-2">
        {popover(
          'dates',
          dateLabel,
          <CalendarRange raw={{ from, to }} campaigns={campaigns} update={update} />,
        )}
        {primary.map(filter)}
        <button
          type="button"
          className={button}
          aria-expanded={more}
          onClick={() => {
            close();
            setMore(!more);
          }}
        >
          {t('moreFilters')}
          <ChevronDown aria-hidden="true" size={14} />
        </button>
        <button
          type="button"
          className={button}
          disabled={!Object.keys(raw).length}
          onClick={() => {
            close();
            update(Object.fromEntries([...names, 'from', 'to'].map((name) => [name, ''])));
          }}
        >
          {t('reset')}
        </button>
      </div>
      {more && <div className="relative flex flex-wrap gap-2">{secondary.map(filter)}</div>}
      <div className="flex flex-wrap gap-1.5 empty:hidden">
        {names.flatMap((name) => {
          const selected = idsOf(raw[name]);
          return entries[name]
            .filter(({ id }) => selected.includes(id))
            .map(({ id, label }) => (
              <button
                type="button"
                key={name + id}
                className={button}
                aria-label={t('removeFilter', { filter: t(name), label })}
                onClick={() =>
                  update({ [name]: selected.filter((value) => value !== id).join(',') })
                }
              >
                <span className="max-w-48 truncate">{label}</span>
                <X size={12} aria-hidden="true" />
              </button>
            ));
        })}
      </div>
    </section>
  );
}
