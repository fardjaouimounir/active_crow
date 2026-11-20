import { afterEach, expect, it, vi } from 'vitest';
import axios from 'axios';
import { installAuthInterceptors } from '../src/shared/auth/interceptors.js';
import { fieldPwa } from '../field-pwa.js';
import { resizeFieldImage } from '../src/surfaces/field/image.js';
import ar from '../src/surfaces/field/ar.json';
import en from '../src/surfaces/field/en.json';
import arCommon from '../src/shared/i18n/locales/ar/common.json';
import enCommon from '../src/shared/i18n/locales/en/common.json';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('precaches only static file patterns and denies every API navigation', () => {
  expect(fieldPwa.workbox.runtimeCaching).toEqual([]);
  for (const url of ['/api', '/api/v1', '/api/v1/me/sales/today', '/api?test=1']) {
    expect(fieldPwa.workbox.navigateFallbackDenylist.some((pattern) => pattern.test(url))).toBe(
      true,
    );
    expect(fieldPwa.workbox.navigateFallbackAllowlist.some((pattern) => pattern.test(url))).toBe(
      false,
    );
  }
  expect(fieldPwa.manifest).toMatchObject({
    start_url: '/field',
    lang: 'ar',
    dir: 'rtl',
    display: 'standalone',
  });
});

it('resizes normalized camera images to a 1600px JPEG at quality 0.8', async () => {
  const bitmap = { width: 3200, height: 2400, close: vi.fn() };
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage });
  const toBlob = vi
    .spyOn(HTMLCanvasElement.prototype, 'toBlob')
    .mockImplementation((done) => done(new Blob(['jpeg'], { type: 'image/jpeg' })));
  const file = await resizeFieldImage(new File(['image'], 'camera.png', { type: 'image/png' }));
  expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 1600, 1200);
  expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.8);
  expect(file.type).toBe('image/jpeg');
  expect(bitmap.close).toHaveBeenCalled();
});

it('localizes field API errors in Arabic and English', () => {
  const codes = [
    'NETWORK_ERROR',
    'NOT_ASSIGNMENT_OWNER',
    'FIELD_ENTRY_NOT_ALLOWED',
    'UNKNOWN_CHECKPOINT',
    'CHECKPOINT_NOT_OPEN',
    'PHOTO_REQUIRED',
    'GPS_REQUIRED',
    'CHECKPOINT_ALREADY_RECORDED',
    'PRODUCT_NOT_IN_CAMPAIGN',
    'CUSTOMER_FIELDS_REQUIRED',
    'INVALID_PHONE',
    'CUSTOMER_LIMIT_REACHED',
    'ENTITLEMENT_NOT_UNDELIVERED',
    'ENTITLEMENT_NOT_DISTRIBUTABLE',
    'INSUFFICIENT_STOCK',
    'IDEMPOTENCY_KEY_REQUIRED',
    'IDEMPOTENCY_KEY_REUSED',
    'FILE_TOO_LARGE',
    'FILE_TYPE_NOT_ALLOWED',
    'VALIDATION_FAILED',
    'NOT_FOUND',
    'FORBIDDEN',
    'RATE_LIMITED',
    'INTERNAL_ERROR',
    'NOT_ASSIGNED_HERE',
    'CAMPAIGN_NOT_ACCEPTING_ISSUES',
    'TRANSFER_NOT_PENDING',
    'MOVEMENT_NOT_ALLOWED_IN_STATUS',
    'QUANTITY_EXCEEDS_SENT',
    'NOT_RECIPIENT',
  ];
  for (const code of codes) {
    expect(en.errors[code] ?? enCommon.errors.codes[code], code + ' (English)').toBeTruthy();
    expect(ar.errors[code] ?? arCommon.errors.codes[code], code + ' (Arabic)').toBeTruthy();
  }
  expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
});

it('does not replay a delayed field 401 after the session changes during refresh', async () => {
  let current = true;
  const adapter = vi.fn(async (config) => {
    throw Object.assign(new Error('Expired'), { status: 401, config });
  });
  const client = axios.create({ adapter });
  const refresh = vi.fn(async () => {
    current = false;
  });
  const lost = vi.fn();
  installAuthInterceptors(client, { getAccessToken: () => 'token', refresh, onSessionLost: lost });
  await expect(client.post('/issues', {}, { fieldSessionCheck: () => current })).rejects.toThrow(
    'Expired',
  );
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(adapter).toHaveBeenCalledTimes(1);
  expect(lost).not.toHaveBeenCalled();
});
