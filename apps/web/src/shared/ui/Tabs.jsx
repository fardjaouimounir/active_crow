import { useId } from 'react';
import { TabStrip } from '../../ui/data.jsx';

/** Accessible tab strip; the caller owns the selected value (keep it in the URL). */
export function Tabs({ label, tabs, value, onChange, children }) {
  const id = useId();
  return (
    <>
      <TabStrip label={label} tabs={tabs} value={value} onChange={onChange} idPrefix={id} />
      <div role="tabpanel" id={id + '-panel'} aria-labelledby={id + '-tab-' + value}>
        {children}
      </div>
    </>
  );
}
