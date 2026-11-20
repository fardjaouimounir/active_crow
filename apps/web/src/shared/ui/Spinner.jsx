import { LoaderCircle } from 'lucide-react';

/**
 * Loading indicator. With a `label`, the label is shown and announced to screen readers.
 * @param {{ label?: string, className?: string }} props
 */
export function Spinner({ label, className = '' }) {
  return (
    <span role="status" className={`inline-flex items-center gap-2 text-fg-2 ${className}`}>
      <LoaderCircle aria-hidden="true" className="size-4 animate-spin" strokeWidth={1.5} />
      {label && <span>{label}</span>}
    </span>
  );
}
