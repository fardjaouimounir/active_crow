import { useSearchParams } from 'react-router';

/** Maps URL parameters to filters and resets pagination on filter changes. */
export function useFilters() {
  const [params, setParams] = useSearchParams();
  const filters = Object.fromEntries(params);
  const setFilters = (values) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [name, value] of Object.entries(values)) {
          if (value == null || value === '') next.delete(name);
          else next.set(name, value);
        }
        if (!Object.hasOwn(values, 'page')) next.delete('page');
        return next;
      },
      { replace: !Object.hasOwn(values, 'page') },
    );
  const setFilter = (name, value) => setFilters({ [name]: value });
  return { filters, setFilter, setFilters };
}

/** Arranges controls for a URL-backed result set. */
export function FilterBar({ children }) {
  return <div className="mb-4 flex flex-wrap items-end gap-3">{children}</div>;
}
