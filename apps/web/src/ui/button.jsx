/** Joins class names, skipping falsy values. */
export function cn(...parts) {
  return parts.filter(Boolean).join(' ');
}

const BUTTON_SIZES = {
  sm: 'h-8 gap-1.5 px-3 text-sm',
  md: 'h-9 gap-2 px-3.5 text-sm',
  lg: 'h-11 gap-2 px-5 text-base',
  field: 'h-14 gap-2 px-5 text-lg',
};

const BUTTON_VARIANTS = {
  primary: 'bg-accent text-accent-fg font-semibold hover:bg-accent-hover',
  secondary: 'border border-control bg-surface text-fg font-medium hover:bg-sunken',
  ghost: 'text-fg-2 font-medium hover:bg-sunken hover:text-fg',
  danger: 'bg-danger-solid text-danger-fg font-semibold hover:opacity-90',
};

/** Class string for anything that must look like a button (links, labels). */
export function buttonClass({ variant = 'secondary', size = 'md', className = '' } = {}) {
  return cn(
    'inline-flex shrink-0 items-center justify-center rounded-md whitespace-nowrap transition-colors duration-[var(--dur-fast)] ease-out',
    'disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:opacity-50',
    BUTTON_SIZES[size],
    BUTTON_VARIANTS[variant],
    className,
  );
}

export function Button({ variant, size, className, type = 'button', ...props }) {
  return <button type={type} className={buttonClass({ variant, size, className })} {...props} />;
}
