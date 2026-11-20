import { useId } from 'react';

/** Accessible tab strip; the caller owns the selected value (keep it in the URL). */
export function Tabs({ label, tabs, value, onChange, children }) {
  const id = useId();
  return (
    <>
      <div
        role="tablist"
        aria-label={label}
        className="mb-4 flex flex-wrap gap-1 border-b border-slate-200"
      >
        {tabs.map((tab) => {
          const selected = tab.value === value;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              id={id + '-tab-' + tab.value}
              aria-selected={selected}
              aria-controls={id + '-panel'}
              onClick={() => onChange(tab.value)}
              className={
                '-mb-px border-b-2 px-3 py-2 text-sm font-medium ' +
                (selected
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900')
              }
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={id + '-panel'} aria-labelledby={id + '-tab-' + value}>
        {children}
      </div>
    </>
  );
}
