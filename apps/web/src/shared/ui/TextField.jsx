import { useId } from 'react';
import { Input } from '../../ui/primitives.jsx';

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
    <div className={`space-y-1.5 ${className}`}>
      <label htmlFor={id} className="block text-sm font-medium text-fg">
        {label}
      </label>
      <Input
        id={id}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy}
        className="h-10 text-start"
        {...inputProps}
      />
      {error && (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      )}
      {hint && (
        <div id={hintId} className="text-sm text-fg-2">
          {hint}
        </div>
      )}
    </div>
  );
}
