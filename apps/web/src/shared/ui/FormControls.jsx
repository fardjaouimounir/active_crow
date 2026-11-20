import { Copy } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, SelectControl } from '../../ui/primitives.jsx';

/** Labels a control and connects its validation message to screen readers. */
export function FormField({ label, error, children }) {
  const id = useId();
  return (
    <div className="grid gap-1 text-sm">
      <label htmlFor={id} className="font-medium text-fg">
        {label}
      </label>
      {children({
        id,
        'aria-invalid': Boolean(error),
        'aria-describedby': error ? id + '-error' : undefined,
      })}
      {error && (
        <p id={id + '-error'} className="text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** Styled input for text, numbers, and other native input types. */
export function TextInput(props) {
  return <Input {...props} />;
}

/** Native select supporting single and multiple choices. */
export function Select({ children, ...props }) {
  return <SelectControl {...props}>{children}</SelectControl>;
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
      {error && (
        <span role="alert" className="text-danger">
          {t('errors.codes.INTERNAL_ERROR')}
        </span>
      )}
      <Select
        {...props}
        value={value ?? ''}
        onChange={(event) =>
          onChange(event.target.value, event.target.selectedOptions[0]?.textContent)
        }
        aria-busy={pending}
      >
        <option value="">{t(pending ? 'admin.loading' : 'admin.choose')}</option>
        {retained && <option value={value}>{selectedLabel ?? value}</option>}
        {options.map(({ value: id, label, disabled }) => (
          <option key={id} value={id} disabled={disabled}>
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
        <Button
          variant="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setState('copied');
            } catch {
              setState('copyFailed');
            }
          }}
        >
          <Copy aria-hidden="true" size={14} strokeWidth={1.5} />
          {t('admin.copy')}
        </Button>
      </div>
      {state && (
        <p role="status" className="text-sm text-fg-2">
          {t('admin.' + state)}
        </p>
      )}
    </div>
  );
}
