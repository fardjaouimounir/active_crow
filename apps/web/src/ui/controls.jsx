import { Moon, Sun } from 'lucide-react';
import { createContext, useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from './theme.js';
import { cn } from './primitives.jsx';

/** Square icon-only button used in bars; needs an accessible `label`. */
export function IconButton({ label, className, children, ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'relative inline-flex size-8 shrink-0 items-center justify-center rounded-md text-fg-2 transition-colors duration-[var(--dur-fast)] hover:bg-sunken hover:text-fg',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/** Light/dark switch; the preference is saved per surface in this browser. */
export function ThemeToggle({ className }) {
  const { t } = useTranslation('common');
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  return (
    <IconButton
      label={t(dark ? 'ui.theme.toLight' : 'ui.theme.toDark')}
      onClick={toggle}
      className={className}
    >
      {dark ? (
        <Sun aria-hidden="true" size={16} strokeWidth={1.5} />
      ) : (
        <Moon aria-hidden="true" size={16} strokeWidth={1.5} />
      )}
    </IconButton>
  );
}

/* Pages name the last breadcrumb ("Ramadan 2027", a user's name…) through this context. */
const CrumbContext = createContext({ tail: null, setTail: () => {} });

export function CrumbProvider({ children }) {
  const [tail, setTail] = useState(null);
  return <CrumbContext.Provider value={{ tail, setTail }}>{children}</CrumbContext.Provider>;
}

export function useCrumbTail() {
  return useContext(CrumbContext).tail;
}

/** Call from a detail page with the record's name; cleared on unmount. */
export function usePageCrumb(label) {
  const { setTail } = useContext(CrumbContext);
  useEffect(() => {
    setTail(label || null);
    return () => setTail(null);
  }, [label, setTail]);
}
