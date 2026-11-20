import { cn } from '../../ui/primitives.jsx';

/**
 * Hairline-bordered section. No shadow: depth comes from borders and spacing.
 * @param {{ title?: import('react').ReactNode, children: import('react').ReactNode, className?: string }} props
 */
export function Card({ title, children, className = '' }) {
  return (
    <section className={cn('rounded-lg border border-line bg-surface p-4', className)}>
      {title && <h2 className="mb-3 text-base font-semibold tracking-tight text-fg">{title}</h2>}
      {children}
    </section>
  );
}
