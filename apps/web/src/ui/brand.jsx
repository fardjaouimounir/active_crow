import markUrl from '../assets/brand/logo-mark.png';
import { cn } from './button.jsx';

/**
 * The R-arrow mark on its rounded square (the supplied artwork, never redrawn).
 * Radius is ≈ 22 % of the size, the same shape used for avatars and badges.
 */
export function LogoMark({ size = 32, className = '', title }) {
  return (
    <img
      src={markUrl}
      width={size}
      height={size}
      alt={title ?? ''}
      aria-hidden={title ? undefined : true}
      className={cn('shrink-0 select-none', className)}
      style={{ borderRadius: '22%' }}
    />
  );
}

/** "Acticrew" wordmark set in the UI face until the SVG export of the supplied wordmark lands. */
export function Wordmark({ className = '' }) {
  return (
    <span className={cn('font-bold tracking-tight', className)} dir="ltr" lang="en">
      Acticrew
    </span>
  );
}
