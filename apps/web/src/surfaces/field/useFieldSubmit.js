import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { useAuth } from '../../shared/auth/hooks.js';
import { authStore } from '../../shared/auth/authStore.js';
import { readFieldDraft, writeFieldDraft } from '../../shared/auth/fieldDrafts.js';
import { fieldRequest } from './api.js';
import { resizeFieldImage } from './image.js';

const MAX_STORED_FILE = 2 * 1024 * 1024;
const MAX_KEY_AGE = 48 * 60 * 60 * 1000;
function requestKey() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

function serializeFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ contents: reader.result, name: file.name, type: file.type });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function restoreFile(file) {
  if (!file) return undefined;
  const bytes = Uint8Array.from(atob(file.contents.split(',')[1]), (character) =>
    character.charCodeAt(0),
  );
  return new File([bytes], file.name, { type: file.type });
}
function bodyFor(draft, file) {
  if (!draft.multipart && !file) return draft.body;
  const data = new FormData();
  for (const [key, value] of Object.entries(draft.body)) {
    if (value === undefined || value === null) continue;
    data.append(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  if (file) data.append(draft.fileField, file);
  return data;
}
const isDefinitive = (error) =>
  error.status >= 400 &&
  error.status < 500 &&
  ![401, 408, 429].includes(error.status) &&
  error.code !== 'IDEMPOTENCY_KEY_REUSED';

const slots = new Map();
const listeners = new Set();
const empty = Object.freeze({ pending: null, problem: null, attempt: null, file: null, key: null });

function broadcast() {
  for (const listener of listeners) listener();
}
function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function clearFieldRuntime() {
  for (const value of slots.values()) value.attempt?.controller.abort();
  slots.clear();
  broadcast();
}
window.addEventListener('fieldflow:drafts-cleared', clearFieldRuntime);
let lastVersion = authStore.getSessionVersion();
authStore.subscribe(() => {
  const version = authStore.getSessionVersion();
  if (version !== lastVersion) clearFieldRuntime();
  lastVersion = version;
});

function digest(file) {
  if (!crypto.subtle) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => resolve(crypto.subtle.digest('SHA-256', reader.result));
    reader.readAsArrayBuffer(file);
  }).then((hash) =>
    Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join(''),
  );
}

export function useFieldSubmit(slot, onSuccess = undefined) {
  const { user } = useAuth();
  const userId = user?.id;
  const slotKey = userId + ':' + slot;
  const client = useQueryClient();
  function current() {
    if (!userId) return empty;
    if (!slots.has(slotKey)) {
      const pending = readFieldDraft(userId, slot);
      slots.set(slotKey, { ...empty, pending, key: pending?.key ?? requestKey() });
    }
    return slots.get(slotKey);
  }
  function update(patch) {
    slots.set(slotKey, { ...current(), ...patch });
    broadcast();
  }
  const state = useSyncExternalStore(subscribe, current, current);
  const mutation = useMutation({
    mutationFn: ({ draft, file, attempt, isCurrent }) =>
      fieldRequest({
        method: 'post',
        url: draft.path,
        data: bodyFor(draft, file),
        headers: { 'Idempotency-Key': draft.key },
        signal: attempt.controller.signal,
        fieldSessionCheck: isCurrent,
      }),
    retry: false,
    networkMode: 'always',
    gcTime: 0,
  });

  function begin(draft, file) {
    const version = authStore.getSessionVersion();
    const attempt = { controller: new AbortController() };
    const isCurrent = () =>
      authStore.getSessionVersion() === version &&
      !authStore.isClosing() &&
      authStore.getSnapshot().user?.id === userId &&
      slots.get(slotKey)?.attempt === attempt &&
      !attempt.controller.signal.aborted;
    update({ attempt, pending: draft, file, problem: null });
    return { attempt, isCurrent };
  }

  function finish(draft, isCurrent, problem = null, keep = false) {
    if (!isCurrent() || current().pending?.key !== draft.key) return false;
    if (!keep) writeFieldDraft(userId, slot, null);
    update({
      attempt: null,
      problem,
      ...(keep ? {} : { pending: null, file: null, key: requestKey() }),
    });
    return true;
  }

  async function transmit(draft, file, operation) {
    try {
      const reply = await mutation.mutateAsync({ draft, file, ...operation });
      if (finish(draft, operation.isCurrent)) {
        onSuccess?.(reply.data);
        void client.invalidateQueries({ queryKey: ['field', userId] });
      }
    } catch (error) {
      finish(draft, operation.isCurrent, error.code ?? 'NETWORK_ERROR', !isDefinitive(error));
    } finally {
      mutation.reset();
    }
  }

  async function submit({ path, body, file, fileField, multipart = false }) {
    if (!userId || authStore.isClosing() || current().pending || current().attempt) return;
    let draft = {
      path,
      body,
      multipart,
      fileField,
      needsFile: Boolean(file),
      key: current().key,
      createdAt: Date.now(),
    };
    const operation = begin(draft, file);
    writeFieldDraft(userId, slot, draft);
    if (file) {
      const [saved, fingerprint] = await Promise.allSettled([
        file.size <= MAX_STORED_FILE ? serializeFile(file) : undefined,
        digest(file),
      ]);
      if (!operation.isCurrent()) return;
      draft = { ...draft, file: saved.value, fingerprint: fingerprint.value };
      if (!writeFieldDraft(userId, slot, draft) && draft.file) {
        draft = { ...draft, file: undefined };
        writeFieldDraft(userId, slot, draft);
      }
      update({ pending: draft });
    }
    await transmit(draft, file, operation);
  }

  async function retry(replacement) {
    const { pending, file, attempt } = current();
    if (!userId || authStore.isClosing() || !pending || attempt) return;
    if (Date.now() - pending.createdAt >= MAX_KEY_AGE) {
      update({ problem: 'DRAFT_EXPIRED' });
      return;
    }
    const original = file ?? restoreFile(pending.file);
    let attachment = original ?? replacement;
    const operation = begin(pending, original);
    if (pending.needsFile && !original) {
      let identity = replacement && (await digest(replacement).catch(() => null));
      if (replacement && pending.fingerprint && identity !== pending.fingerprint) {
        attachment = await resizeFieldImage(replacement).catch(() => replacement);
        identity = await digest(attachment).catch(() => null);
      }
      if (!attachment || !pending.fingerprint || identity !== pending.fingerprint) {
        finish(
          pending,
          operation.isCurrent,
          attachment ? 'DIFFERENT_FILE' : 'ATTACH_FILE_AGAIN',
          true,
        );
        return;
      }
    }
    if (operation.isCurrent()) await transmit(pending, attachment, operation);
  }

  function discard() {
    if (!userId || current().attempt) return;
    writeFieldDraft(userId, slot, null);
    update({ ...empty, key: requestKey() });
  }

  const needsAttachment = state.pending?.needsFile && !state.pending.file && !state.file;
  return {
    submit,
    retry,
    discard,
    pending: state.pending,
    problem: state.problem,
    busy: Boolean(state.attempt),
    needsAttachment,
  };
}
