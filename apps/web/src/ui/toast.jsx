import { createContext, useCallback, useContext, useState } from 'react';

const join = (...parts) => parts.filter(Boolean).join(' ');
const ToastContext = createContext(null);

/** Mount once; descendants call `useToast()(message, { error })`. Auto-dismisses after 5 s. */
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((message, { error = false } = {}) => {
    const id = crypto.randomUUID();
    setItems((current) => [...current.slice(-3), { id, message, error }]);
    setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 5000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-3 bottom-3 z-50 grid justify-items-end gap-2 sm:inset-x-auto sm:end-4 sm:bottom-4">
        {items.map((item) => (
          <p
            key={item.id}
            role={item.error ? 'alert' : 'status'}
            className={join(
              'pointer-events-auto max-w-sm rounded-lg border px-3 py-2 text-sm shadow-lg',
              item.error
                ? 'border-danger-line bg-danger-soft text-danger'
                : 'border-line bg-raised text-fg',
            )}
          >
            {item.message}
          </p>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext) ?? (() => {});
}
