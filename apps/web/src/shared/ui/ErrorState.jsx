import { CircleAlert, RefreshCw } from 'lucide-react';

/**
 * Inline error block with an optional retry action. All strings are passed in already translated.
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
    <div role="alert" className="flex items-start gap-3 rounded-lg bg-red-50 p-4 text-red-900">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-red-600" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium">{title}</p>
        {message && <p className="text-sm text-red-800">{message}</p>}
        {hint && <p className="text-xs text-red-700">{hint}</p>}
        {onRetry && retryLabel && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 inline-flex items-center gap-2 rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-100"
          >
            <RefreshCw aria-hidden="true" className="size-4" />
            {retryLabel}
          </button>
        )}
      </div>
    </div>
  );
}
