import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../app.js';
import { env } from '../../../config/env.js';
import { storage } from '../../../core/storage/index.js';
import { assertKey } from '../../../core/storage/keys.js';
import { businessDate } from '../../../core/time/clock.js';
import { createAgency, createClient, createUser } from '../../../db/__tests__/factories.js';
import { prisma } from '../../../db/client.js';
import { bearer, createUserWithPassword, login } from '../../../../test/helpers/auth.js';
import { fileService } from '../files.service.js';

const app = createApp();
const root = '/api/v1';
const auth = {};
const people = {};
let agency;
let clientX;
let clientY;

const MB = 1024 * 1024;
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n',
);
const future = (days) => {
  const date = new Date(businessDate() + 'T00:00:00.000Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/** A 2400×1200 JPEG with a GPS position and an EXIF orientation. */
function photoWithGps() {
  return sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#c33' } })
    .jpeg()
    .withExif({
      IFD0: { Make: 'TestCam', Orientation: '1' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '36/1 45/1 0/1' },
    })
    .toBuffer();
}

async function filesOnDisk(dir = env.UPLOAD_DIR) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

function send(method, path, actor = 'director') {
  const req = request(app)[method](root + path);
  return actor ? req.set(auth[actor]) : req;
}

async function ok(req, status) {
  const res = await req;
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res;
}

async function rejected(req, status, code) {
  const res = await req;
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(res.body.error.code).toBe(code);
}

async function campaignFor(client) {
  const res = await ok(
    send('post', '/campaigns').send({
      clientId: client.id,
      name: 'Files ' + client.name,
      startDate: future(5),
      endDate: future(40),
    }),
    201,
  );
  return res.body.data;
}

const upload = (campaignId, buffer, filename, label = 'Mécanisme', actor = 'director') =>
  send('post', '/campaigns/' + campaignId + '/documents', actor)
    .field('label', label)
    .attach('file', buffer, filename);

beforeAll(async () => {
  agency = await createAgency();
  clientX = await createClient(agency.id, { name: 'Client X' });
  clientY = await createClient(agency.id, { name: 'Client Y' });
  for (const [name, data] of Object.entries({
    director: { role: 'director' },
    supervisor: { role: 'supervisor' },
    clientUser: { role: 'client', clientId: clientX.id },
  })) {
    people[name] = await createUserWithPassword(agency.id, data);
    auth[name] = bearer((await login(app, people[name])).accessToken);
  }
});

describe('storage keys', () => {
  it('rejects traversal and absolute keys', () => {
    for (const key of ['../etc/passwd', 'agency/../../x', '/abs/path', 'a\\b', 'a/./../b']) {
      expect(() => assertKey(key), key).toThrow('Invalid storage key');
    }
    expect(assertKey('agency/a-1/campaign_document/2027/02/x.pdf')).toBeTruthy();
  });
});

describe('FR-032 upload pipeline', () => {
  it('stores a PDF unchanged with its hash and audits id, kind, size and hash', async () => {
    const campaign = await campaignFor(clientX);
    const res = await ok(upload(campaign.id, PDF, 'mecanisme.pdf'), 201);
    const document = res.body.data;
    expect(document).toMatchObject({
      label: 'Mécanisme',
      mimeType: 'application/pdf',
      sizeBytes: PDF.length,
      hasThumbnail: false,
      visibility: 'internal',
    });
    const file = await prisma.file.findUnique({ where: { id: document.fileId } });
    expect(file.sha256).toBe(createHash('sha256').update(PDF).digest('hex'));
    expect(file.storageKey).toMatch(
      new RegExp('^agency/' + agency.id + '/campaign_document/\\d{4}/\\d{2}/[0-9a-f-]{36}\\.pdf$'),
    );
    expect(file.storageKey).not.toContain('mecanisme');
    const download = await ok(send('get', '/files/' + file.id).buffer(true), 200);
    expect(Buffer.compare(download.body, PDF)).toBe(0);
    expect(download.headers).toMatchObject({
      'content-type': 'application/pdf',
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, max-age=300',
    });
    expect(download.headers['content-disposition']).toBe(
      `inline; filename="M_canisme.pdf"; filename*=UTF-8''M%C3%A9canisme.pdf`,
    );
    const [audit] = await prisma.auditLog.findMany({
      where: { entityId: file.id, action: 'file.uploaded' },
      select: { after: true },
    });
    expect(audit.after).toEqual({
      id: file.id,
      kind: 'campaign_document',
      mimeType: 'application/pdf',
      sizeBytes: PDF.length,
      sha256: file.sha256,
    });
  });

  it('re-encodes a JPEG to WebP without metadata and makes a 400 px thumbnail', async () => {
    const campaign = await campaignFor(clientX);
    const photo = await photoWithGps();
    expect((await sharp(photo).metadata()).exif?.toString('latin1')).toContain('TestCam');
    const res = await ok(upload(campaign.id, photo, 'IMG_0001.jpg', 'Shelf photo'), 201);
    expect(res.body.data).toMatchObject({
      mimeType: 'image/webp',
      width: 1600,
      height: 800,
      hasThumbnail: true,
    });
    const stored = await ok(send('get', '/files/' + res.body.data.fileId).buffer(true), 200);
    expect(stored.headers['content-type']).toBe('image/webp');
    const metadata = await sharp(stored.body).metadata();
    expect(metadata).toMatchObject({ format: 'webp', width: 1600, height: 800 });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(stored.body.includes(Buffer.from('GPS'))).toBe(false);
    expect(stored.body.includes(Buffer.from('TestCam'))).toBe(false);
    const thumbnail = await ok(
      send('get', '/files/' + res.body.data.fileId + '/thumbnail').buffer(true),
      200,
    );
    expect(await sharp(thumbnail.body).metadata()).toMatchObject({ width: 400, height: 200 });
  });

  it('sniffs the content: a .pdf that is HTML or an executable is refused', async () => {
    const campaign = await campaignFor(clientX);
    const html = Buffer.from('<!doctype html><html><script>alert(1)</script></html>');
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200), Buffer.from('PE\0\0')]);
    const before = await filesOnDisk();
    await rejected(upload(campaign.id, html, 'mecanisme.pdf'), 422, 'FILE_TYPE_NOT_ALLOWED');
    await rejected(upload(campaign.id, exe, 'mecanisme.pdf'), 422, 'FILE_TYPE_NOT_ALLOWED');
    expect(await filesOnDisk()).toEqual(before);
  });

  it('enforces size limits before and after sniffing', async () => {
    const campaign = await campaignFor(clientX);
    const huge = Buffer.concat([PDF, Buffer.alloc(20 * MB)]);
    await rejected(upload(campaign.id, huge, 'big.pdf'), 413, 'FILE_TOO_LARGE');
    const smallJpeg = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#000' },
    })
      .jpeg()
      .toBuffer();
    const bigImage = Buffer.concat([smallJpeg, Buffer.alloc(11 * MB)]);
    await rejected(upload(campaign.id, bigImage, 'big.jpg'), 413, 'FILE_TOO_LARGE');
  });

  it('validates the multipart fields', async () => {
    const campaign = await campaignFor(clientX);
    await rejected(upload(campaign.id, PDF, 'a.pdf', ''), 400, 'VALIDATION_FAILED');
    await rejected(upload(campaign.id, PDF, 'a.pdf', 'x'.repeat(121)), 400, 'VALIDATION_FAILED');
    await rejected(
      send('post', '/campaigns/' + campaign.id + '/documents').field('label', 'No file'),
      400,
      'VALIDATION_FAILED',
    );
    await rejected(
      send('post', '/campaigns/' + campaign.id + '/documents')
        .field('label', 'Two')
        .attach('other', PDF, 'a.pdf'),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('deletes the bytes when the transaction rolls back', async () => {
    const before = await filesOnDisk();
    const actor = { type: 'user', id: people.director.id, agencyId: agency.id };
    const photo = await photoWithGps();
    let written;
    await expect(
      fileService.transaction(async (tx) => {
        written = await fileService.store(tx, { actor, kind: 'campaign_document', buffer: photo });
        expect(await storage.exists(written.storageKey)).toBe(true);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await storage.exists(written.storageKey)).toBe(false);
    expect(await storage.exists(written.thumbnailKey)).toBe(false);
    expect(await filesOnDisk()).toEqual(before);
    expect(await prisma.file.count({ where: { id: written.id } })).toBe(0);
  });

  it('refuses store() outside a file transaction', async () => {
    await expect(
      prisma.$transaction((tx) =>
        fileService.store(tx, { actor: people.director, kind: 'campaign_document', buffer: PDF }),
      ),
    ).rejects.toThrow(/fileService.transaction/);
  });
});

describe('file access (delegated policies)', () => {
  it('Q-16 serves shared documents to their client only, everything else is 404', async () => {
    const own = await campaignFor(clientX);
    // Clients never see a draft campaign: the portal starts at `assigned`.
    await prisma.campaign.update({ where: { id: own.id }, data: { status: 'active' } });
    const other = await campaignFor(clientY);
    const shared = (await ok(upload(own.id, PDF, 'm.pdf', 'Shared'), 201)).body.data;
    const internal = (await ok(upload(own.id, PDF, 'i.pdf', 'Internal'), 201)).body.data;
    const foreign = (await ok(upload(other.id, PDF, 'f.pdf', 'Foreign'), 201)).body.data;
    for (const document of [shared, foreign]) {
      await ok(
        send('patch', '/files/' + document.fileId + '/visibility').send({
          visibility: 'client_visible',
        }),
        200,
      );
    }
    await ok(send('get', '/files/' + shared.fileId, 'clientUser'), 200);
    await rejected(send('get', '/files/' + internal.fileId, 'clientUser'), 404, 'NOT_FOUND');
    await rejected(send('get', '/files/' + foreign.fileId, 'clientUser'), 404, 'NOT_FOUND');
    // The staff list is closed to clients; they read the shared documents through the portal.
    await rejected(
      send('get', '/campaigns/' + own.id + '/documents', 'clientUser'),
      404,
      'NOT_FOUND',
    );
    const listed = await ok(
      send('get', '/portal/campaigns/' + own.id + '/documents', 'clientUser'),
      200,
    );
    expect(listed.body.data.map(({ fileId }) => fileId)).toEqual([shared.fileId]);
    expect(listed.body.data[0].uploadedBy).toBeUndefined();
    await ok(
      send('patch', '/files/' + shared.fileId + '/visibility').send({ visibility: 'internal' }),
      200,
    );
    await rejected(send('get', '/files/' + shared.fileId, 'clientUser'), 404, 'NOT_FOUND');
  });

  it('is 404 out of scope, for unknown ids and for unregistered kinds', async () => {
    const campaign = await campaignFor(clientX);
    const document = (await ok(upload(campaign.id, PDF, 'm.pdf'), 201)).body.data;
    await rejected(send('get', '/files/' + document.fileId, 'supervisor'), 404, 'NOT_FOUND');
    await rejected(send('get', '/files/00000000-0000-4000-8000-000000000000'), 404, 'NOT_FOUND');
    await rejected(send('get', '/files/' + document.fileId + '/thumbnail'), 404, 'NOT_FOUND');
    await rejected(send('get', '/files/' + document.fileId, null), 401, 'UNAUTHENTICATED');
    const proof = await prisma.file.create({
      data: {
        agencyId: agency.id,
        kind: 'attendance_proof',
        storageKey: 'agency/' + agency.id + '/attendance_proof/2027/01/x.webp',
        mimeType: 'image/webp',
        sizeBytes: 10,
        sha256: 'x',
        uploadedById: people.director.id,
      },
    });
    await rejected(send('get', '/files/' + proof.id), 404, 'NOT_FOUND');
    const otherAgency = await createAgency();
    const outsider = await createUser(otherAgency.id, { role: 'director' });
    const foreignFile = await prisma.file.create({
      data: {
        agencyId: otherAgency.id,
        kind: 'campaign_document',
        storageKey: 'agency/' + otherAgency.id + '/campaign_document/2027/01/y.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        sha256: 'y',
        uploadedById: outsider.id,
      },
    });
    await rejected(send('get', '/files/' + foreignFile.id), 404, 'NOT_FOUND');
  });

  it('Module 11 never lets attendance proofs become client-visible', async () => {
    const proof = await prisma.file.create({
      data: {
        agencyId: agency.id,
        kind: 'attendance_proof',
        storageKey: 'agency/' + agency.id + '/attendance_proof/2027/01/z.webp',
        mimeType: 'image/webp',
        sizeBytes: 10,
        sha256: 'z',
        uploadedById: people.director.id,
      },
    });
    await rejected(
      send('patch', '/files/' + proof.id + '/visibility').send({ visibility: 'client_visible' }),
      422,
      'VISIBILITY_NOT_ALLOWED_FOR_KIND',
    );
    const campaign = await campaignFor(clientX);
    const document = (await ok(upload(campaign.id, PDF, 'm.pdf'), 201)).body.data;
    await rejected(
      send('patch', '/files/' + document.fileId + '/visibility', 'supervisor').send({
        visibility: 'client_visible',
      }),
      403,
      'FORBIDDEN',
    );
    await rejected(
      send('patch', '/files/' + document.fileId + '/visibility').send({ visibility: 'public' }),
      400,
      'VALIDATION_FAILED',
    );
  });
});
