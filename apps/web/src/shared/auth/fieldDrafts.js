const prefix = 'fieldflow.pending.';
const storageKey = (userId, slot) => prefix + userId + '.' + slot;

export function readFieldDraft(userId, slot) {
  try {
    const item = sessionStorage.getItem(storageKey(userId, slot));
    return item ? JSON.parse(item) : null;
  } catch {
    return null;
  }
}

export function writeFieldDraft(userId, slot, draft) {
  try {
    const key = storageKey(userId, slot);
    if (draft) sessionStorage.setItem(key, JSON.stringify(draft));
    else sessionStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function clearFieldDrafts() {
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index--) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(prefix)) sessionStorage.removeItem(key);
    }
  } catch {
    // No browser storage is available.
  }
  globalThis.window?.dispatchEvent(new Event('fieldflow:drafts-cleared'));
}
