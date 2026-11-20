import { useId } from 'react';

/**
 * Labelled input with an optional error and hint, wired for screen readers.
 * All strings are passed in already translated.
 * @param {{ label: string, error?: string, hint?: import('react').ReactNode } & import('react').InputHTMLAttributes<HTMLInputElement>} props
 */
export function TextField({ label, error, hint, className = '', ...inputProps }) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error && errorId, hint && hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={`space-y-1 ${className}`}>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy}
        className={`block w-full rounded-lg border bg-white px-3 py-2 text-start text-slate-900 shadow-sm outline-none focus:ring-2 disabled:bg-slate-100 ${
          error
            ? 'border-red-400 focus:border-red-500 focus:ring-red-200'
            : 'border-slate-300 focus:border-slate-500 focus:ring-slate-200'
        }`}
        {...inputProps}
      />
      {error && (
        <p id={errorId} className="text-sm text-red-700">
          {error}
        </p>
      )}
      {hint && (
        <div id={hintId} className="text-sm text-slate-600">
          {hint}
        </div>
      )}
    </div>
  );
}
