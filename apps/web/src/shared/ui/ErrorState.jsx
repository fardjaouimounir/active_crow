import { CircleAlert, RefreshCw } from 'lucide-react';
import { Button } from '../../ui/button.jsx';

/**
 * Inline error block with an optional retry action. All strings are passed in already translated.
 * Icon + title + text, so the state is never conveyed by color alone.
 * @param {{
 *   title: string,
 *   message?: string,
 *   hint?: string,
 *   onRetry?: () => void,
 *   retryLabel?: string,
 * }} props
 */
export function ErrorState({ title, message, hint, onRetry, retryLabel }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-danger-line bg-danger-soft p-4 text-danger"
    >
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-semibold">{title}</p>
        {message && <p className="text-sm text-fg-2">{message}</p>}
        {hint && <p className="text-xs text-fg-3">{hint}</p>}
        {onRetry && retryLabel && (
          <Button size="sm" variant="secondary" onClick={onRetry} className="mt-2">
            <RefreshCw aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
            {retryLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
