import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authStore } from '../src/shared/auth/authStore.js';
import { clearSession } from '../src/shared/auth/session.js';
import { readFieldDraft } from '../src/shared/auth/fieldDrafts.js';
import { clearFieldRuntime, useFieldSubmit } from '../src/surfaces/field/useFieldSubmit.js';

const fieldRequest = vi.hoisted(() => vi.fn());
vi.mock('../src/surfaces/field/api.js', () => ({ fieldRequest }));
const user = { id: 'test-animateur', role: 'animateur' };
const sale = {
  path: '/assignments/assignment-id/sales',
  body: {
    items: [{ productId: 'juice', quantity: 3 }],
    customer: { fullName: 'Test Buyer', phone: '0550123456' },
  },
};

function fixture(onSuccess) {
  const client = new QueryClient();
  return renderHook(() => useFieldSubmit('sale', onSuccess), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

beforeEach(() => {
  authStore.setUser(user);
  sessionStorage.clear();
  fieldRequest.mockReset();
});
afterEach(() => {
  clearSession('logout');
  vi.unstubAllGlobals();
});

describe('field submissions', () => {
  it('retries a timeout with the same key and removes the stored sale and customer after success', async () => {
    fieldRequest
      .mockRejectedValueOnce({ code: 'NETWORK_ERROR' })
      .mockResolvedValueOnce({ data: { id: 'sale' } });
    const saved = vi.fn();
    const { result } = fixture(saved);
    await act(() => result.current.submit(sale));
    const first = fieldRequest.mock.calls[0][0];
    expect(readFieldDraft(user.id, 'sale')).toMatchObject({
      key: first.headers['Idempotency-Key'],
    });
    await act(() => result.current.retry());
    expect(fieldRequest.mock.calls[1][0]).toMatchObject({
      url: first.url,
      data: first.data,
      headers: first.headers,
    });
    expect(saved).toHaveBeenCalledWith({ id: 'sale' });
    expect(readFieldDraft(user.id, 'sale')).toBeNull();
  });

  it('restores a reload and retains the pending attachment, and logout discards drafts', async () => {
    fieldRequest.mockRejectedValue({ code: 'NETWORK_ERROR' });
    const first = fixture();
    const file = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
    await act(() => first.result.current.submit({ ...sale, file, fileField: 'proof' }));
    const key = fieldRequest.mock.calls[0][0].headers['Idempotency-Key'];
    first.unmount();
    clearFieldRuntime();
    const restored = fixture();
    expect(restored.result.current.pending.body).toEqual(sale.body);
    await act(() => restored.result.current.retry());
    const second = fieldRequest.mock.calls[1][0];
    expect(second.headers['Idempotency-Key']).toBe(key);
    expect(second.data.get('proof').size).toBe(file.size);
    await act(() => {
      clearSession('logout');
    });
    expect(sessionStorage.length).toBe(0);
  });

  it('omits large photos from storage and rotates the key only after discarding', async () => {
    fieldRequest.mockRejectedValue({ code: 'NETWORK_ERROR' });
    const first = fixture();
    const file = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'large.jpg', {
      type: 'image/jpeg',
    });
    await act(() => first.result.current.submit({ ...sale, file, fileField: 'proof' }));
    const before = readFieldDraft(user.id, 'sale');
    expect(before).toMatchObject({ needsFile: true });
    expect(before.file).toBeUndefined();
    first.unmount();
    clearFieldRuntime();
    const restored = fixture();
    expect(restored.result.current.needsAttachment).toBe(true);
    act(() => restored.result.current.discard());
    expect(readFieldDraft(user.id, 'sale')).toBeNull();
    await act(() => restored.result.current.submit(sale));
    expect(fieldRequest.mock.calls[1][0].headers['Idempotency-Key']).not.toBe(before.key);
  });

  it('holds a synchronous claim across a route remount and blocks competing submissions', async () => {
    let resolve;
    fieldRequest.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const first = fixture();
    let action;
    act(() => {
      action = first.result.current.submit(sale);
    });
    await waitFor(() => expect(fieldRequest).toHaveBeenCalledTimes(1));
    first.unmount();
    const second = fixture();
    expect(second.result.current.busy).toBe(true);
    await act(async () => {
      second.result.current.discard();
      await second.result.current.submit(sale);
      await second.result.current.retry();
    });
    expect(fieldRequest).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve({ data: { id: 'committed' } });
      await action;
    });
    expect(second.result.current.pending).toBeNull();
  });

  it('abandons the old account request and ignores its delayed success', async () => {
    let resolve;
    fieldRequest.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const onSuccess = vi.fn();
    const first = fixture(onSuccess);
    let action;
    act(() => {
      action = first.result.current.submit(sale);
    });
    await waitFor(() => expect(fieldRequest).toHaveBeenCalledTimes(1));
    const request = fieldRequest.mock.calls[0][0];
    act(() => {
      clearSession('logout');
      authStore.setUser({ id: 'another', role: 'animateur' });
    });
    expect(request.signal.aborted).toBe(true);
    expect(request.fieldSessionCheck()).toBe(false);
    await act(async () => {
      resolve({ data: { id: 'committed' } });
      await action;
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(readFieldDraft(user.id, 'sale')).toBeNull();
  });

  it('rejects a different replacement photo before retrying a restored large upload', async () => {
    vi.stubGlobal('crypto', {
      randomUUID,
      subtle: {
        digest: async (_algo, bytes) => createHash('sha256').update(new Uint8Array(bytes)).digest(),
      },
    });
    fieldRequest
      .mockRejectedValueOnce({ code: 'NETWORK_ERROR' })
      .mockResolvedValueOnce({ data: { id: 'sale' } });
    const original = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'original.jpg', {
      type: 'image/jpeg',
    });
    const first = fixture();
    await act(() => first.result.current.submit({ ...sale, file: original, fileField: 'proof' }));
    const key = readFieldDraft(user.id, 'sale').key;
    first.unmount();
    clearFieldRuntime();
    const second = fixture();
    await act(() =>
      second.result.current.retry(new File(['different'], 'different.jpg', { type: 'image/jpeg' })),
    );
    expect(second.result.current.problem).toBe('DIFFERENT_FILE');
    expect(fieldRequest).toHaveBeenCalledTimes(1);
    await act(() => second.result.current.retry(original));
    expect(fieldRequest.mock.calls[1][0].headers['Idempotency-Key']).toBe(key);
  });
});
import { createHash, randomUUID } from 'node:crypto';
