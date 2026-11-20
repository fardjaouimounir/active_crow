import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

const control =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-60';

/** Labels a control and connects its validation message to screen readers. */
export function FormField({ label, error, children }) {
  const id = useId();
  return (
    <div className="grid gap-1 text-sm">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      {children({
        id,
        'aria-invalid': Boolean(error),
        'aria-describedby': error ? id + '-error' : undefined,
      })}
      {error && (
        <p id={id + '-error'} className="text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

/** Styled input for text, numbers, and other native input types. */
export function TextInput(props) {
  return <input className={control} {...props} />;
}

/** Native select supporting single and multiple choices. */
export function Select({ children, ...props }) {
  return (
    <select className={control} {...props}>
      {children}
    </select>
  );
}

/** Native date control whose value is an ISO business date. */
export function DatePicker(props) {
  return <TextInput type="date" {...props} />;
}

/** Searches remote options and retains the selected item when the search changes. */
export function SearchSelect({ useOptions, value, selectedLabel, onChange, ...props }) {
  const [search, setSearch] = useState('');
  const { t } = useTranslation('common');
  const { options = [], pending, error } = useOptions(search);
  const retained = value && !options.some((item) => item.value === value);
  return (
    <div className="grid gap-2">
      <TextInput
        aria-label={t('admin.search')}
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {error && <span role="alert">{t('errors.codes.INTERNAL_ERROR')}</span>}
      <Select
        {...props}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        aria-busy={pending}
      >
        <option value="">{t(pending ? 'admin.loading' : 'admin.choose')}</option>
        {retained && <option value={value}>{selectedLabel ?? value}</option>}
        {options.map(({ value: id, label }) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </Select>
    </div>
  );
}

/** Displays a one-time value and lets the user copy it. */
export function CopyField({ value }) {
  const { t } = useTranslation('common');
  const [state, setState] = useState('');
  return (
    <div className="grid gap-2">
      <div className="flex gap-2">
        <TextInput readOnly value={value} dir="ltr" aria-label={t('admin.temporaryPassword')} />
        <button
          type="button"
          className="rounded-lg border px-3"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setState('copied');
            } catch {
              setState('copyFailed');
            }
          }}
        >
          {t('admin.copy')}
        </button>
      </div>
      {state && <p role="status">{t('admin.' + state)}</p>}
    </div>
  );
}
