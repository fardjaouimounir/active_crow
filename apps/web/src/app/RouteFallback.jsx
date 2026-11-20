import { Spinner } from '../shared/ui/Spinner.jsx';

/** Shown while a lazy surface chunk loads on first navigation. */
export function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner />
    </div>
  );
}
