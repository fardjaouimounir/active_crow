import { useSyncExternalStore } from 'react';

/**
 * Theme handling. `data-theme` ("dark" | "light") and `data-surface` ("app" | "portal" | "field")
 * live on <html>. Defaults per surface: /app and /portal dark, /field light high-contrast.
 * The choice is a local (per browser) preference stored per surface group.
 * index.html runs the same resolution before first paint so there is no flash of the wrong theme.
 */
export const THEME_DEFAULTS = Object.freeze({ app: 'dark', portal: 'dark', field: 'light' });
const KEY_PREFIX = 'acticrew.theme.';

/** The surface a pathname belongs to ("app" for login and everything else). */
export function surfaceOf(pathname) {
  if (pathname.startsWith('/field')) return 'field';
  if (pathname.startsWith('/portal')) return 'portal';
  return 'app';
}

function readStored(surface) {
  try {
    const value = window.localStorage.getItem(KEY_PREFIX + surface);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null; // storage blocked: default for the surface
  }
}

export function resolveTheme(surface) {
  return readStored(surface) ?? THEME_DEFAULTS[surface];
}

const listeners = new Set();
function emit() {
  for (const listener of listeners) listener();
}

/** Applies the surface's theme to <html>; called by each surface layout on mount. */
export function applySurface(surface) {
  const root = document.documentElement;
  root.dataset.surface = surface;
  root.dataset.theme = resolveTheme(surface);
  emit();
}

export function setTheme(theme) {
  const root = document.documentElement;
  const surface = root.dataset.surface ?? 'app';
  try {
    window.localStorage.setItem(KEY_PREFIX + surface, theme);
  } catch {
    /* The choice lasts for this page view only. */
  }
  root.dataset.theme = theme;
  emit();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** @returns {{ theme: 'dark' | 'light', setTheme: (theme: 'dark' | 'light') => void, toggle: () => void }} */
export function useTheme() {
  const theme = useSyncExternalStore(
    subscribe,
    () => document.documentElement.dataset.theme ?? 'dark',
    () => 'dark',
  );
  return { theme, setTheme, toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark') };
}

/**
 * Printed reports are always light and ink-friendly: switch to the light theme for the print job
 * only, then restore the user's theme. Call once at startup.
 */
export function installPrintTheme() {
  let restore = null;
  window.addEventListener('beforeprint', () => {
    const root = document.documentElement;
    restore = root.dataset.theme;
    root.dataset.theme = 'light';
  });
  window.addEventListener('afterprint', () => {
    if (restore) document.documentElement.dataset.theme = restore;
    restore = null;
  });
}
