import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { parseRange, contentDisposition, streamObject } from '../src/utils/sendStream.js';
import { extensionOf, fileCategory, previewKind, MIME_BY_EXT, EXTENSIONS_BY_CATEGORY, CATEGORIES } from '../src/utils/fileTypes.js';
import { toFileDTO, toFolderDTO, toActivityDTO } from '../src/services/dto.js';
import { createNotificationService, isMuted, toNotificationDTO } from '../src/services/notification.logic.js';
import { setIo, emitToUser } from '../src/services/realtime.js';
import LocalStorageProvider from '../src/services/storage/LocalStorageProvider.js';

// ---------------------------------------------------------------- parseRange
test('parseRange handles open, closed, suffix, clamped and invalid ranges', () => {
  assert.deepEqual(parseRange('bytes=0-9', 100), { start: 0, end: 9 });
  assert.deepEqual(parseRange('bytes=10-', 100), { start: 10, end: 99 });
  assert.deepEqual(parseRange('bytes=-20', 100), { start: 80, end: 99 });
  assert.deepEqual(parseRange('bytes=-500', 100), { start: 0, end: 99 });
  assert.deepEqual(parseRange('bytes=90-500', 100), { start: 90, end: 99 });
  assert.equal(parseRange('bytes=100-', 100), 'unsatisfiable');
  assert.equal(parseRange('bytes=500-600', 100), 'unsatisfiable');
  assert.equal(parseRange('bytes=-0', 100), 'unsatisfiable');
  for (const ignored of [undefined, '', 'bytes=', 'bytes=-', 'bytes=0-1,5-6', 'items=0-1', 'bytes=a-b', 'bytes=9-2', 'bytes=0-1 ']) {
    // trailing space is trimmed => valid; everything else falls back to the whole object
    if (ignored === 'bytes=0-1 ') assert.deepEqual(parseRange(ignored, 100), { start: 0, end: 1 });
    else assert.equal(parseRange(ignored, 100), null, String(ignored));
  }
  assert.equal(parseRange('bytes=0-1', 0), null);
  assert.equal(parseRange('bytes=99999999999999999999-', 100), null);
});

// ----------------------------------------------------- contentDisposition
test('contentDisposition cannot be broken out of by hostile filenames', () => {
  const h = contentDisposition('attachment', 'a"b\\c/d\r\nSet-Cookie: x=1.pdf');
  assert.ok(!/[\r\n]/.test(h));
  assert.match(h, /^attachment; filename="[^"\\]*"; filename\*=UTF-8''[A-Za-z0-9%._-]+$/);
  assert.equal(contentDisposition('inline', 'Report.pdf'), `inline; filename="Report.pdf"; filename*=UTF-8''Report.pdf`);
  assert.equal(contentDisposition('weird', 'x.txt').split(';')[0], 'attachment');
  assert.match(contentDisposition('attachment', 'Résumé 100%.pdf'), /filename="R_sum_ 100_\.pdf"; filename\*=UTF-8''R%C3%A9sum%C3%A9%20100%25\.pdf/);
  assert.match(contentDisposition('attachment', ''), /filename="download"/);
  assert.match(contentDisposition('attachment', "it's (a) *file*.txt"), /filename\*=UTF-8''it%27s%20%28a%29%20%2Afile%2A\.txt/);
});

// ------------------------------------------------------ streamObject (real HTTP)
let root;
let server;
let base;
const BODY = Buffer.from('0123456789'.repeat(10)); // 100 bytes

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-stream-'));
  const storage = new LocalStorageProvider({ root });
  await storage.put('obj/data', BODY);
  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      await streamObject(req, res, {
        storage,
        key: url.searchParams.get('key') ?? 'obj/data',
        size: BODY.length,
        filename: 'Quarterly "Report".pdf',
        mimeType: 'application/pdf',
        disposition: url.searchParams.get('inline') ? 'inline' : 'attachment',
        inlineCsp: "frame-ancestors 'self' http://localhost:5173",
      });
    } catch (err) {
      res.statusCode = err.code === 'NOT_FOUND' ? 404 : 500;
      res.end(err.code ?? 'error');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
  await fs.rm(root, { recursive: true, force: true });
});

test('streamObject: full response with safe headers', async () => {
  const res = await fetch(base);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-length'), '100');
  assert.equal(res.headers.get('accept-ranges'), 'bytes');
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.match(res.headers.get('content-disposition'), /^attachment; filename="Quarterly _Report_\.pdf"/);
  assert.equal(res.headers.get('content-security-policy'), null); // only for inline
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), BODY);
});

test('streamObject: partial content for ranges, 416 when unsatisfiable', async () => {
  let res = await fetch(base, { headers: { range: 'bytes=5-14' } });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), 'bytes 5-14/100');
  assert.equal(res.headers.get('content-length'), '10');
  assert.equal(Buffer.from(await res.arrayBuffer()).toString(), '5678901234');

  res = await fetch(base, { headers: { range: 'bytes=-4' } });
  assert.equal(res.headers.get('content-range'), 'bytes 96-99/100');
  assert.equal(Buffer.from(await res.arrayBuffer()).toString(), '6789');

  res = await fetch(base, { headers: { range: 'bytes=200-' } });
  assert.equal(res.status, 416);
  assert.equal(res.headers.get('content-range'), 'bytes */100');
  await res.arrayBuffer();

  res = await fetch(base, { headers: { range: 'bytes=0-1,4-5' } }); // multi-range: ignored
  assert.equal(res.status, 200);
  await res.arrayBuffer();
});

test('streamObject: inline responses carry the embedding policy; missing objects fail before headers flush', async () => {
  let res = await fetch(`${base}?inline=1`);
  assert.match(res.headers.get('content-disposition'), /^inline;/);
  assert.equal(res.headers.get('content-security-policy'), "frame-ancestors 'self' http://localhost:5173");
  await res.arrayBuffer();

  res = await fetch(`${base}?key=obj/missing`);
  assert.equal(res.status, 404);
  assert.equal(await res.text(), 'NOT_FOUND');
});

// ------------------------------------------------------------------ fileTypes
test('file type helpers', () => {
  assert.equal(extensionOf('Report.Final.PDF'), 'pdf');
  assert.equal(extensionOf('noext'), '');
  assert.equal(extensionOf('.hidden'), '');
  assert.equal(extensionOf('trailing.'), '');
  assert.equal(extensionOf(undefined), '');
  assert.deepEqual(['pdf', 'docx', 'xlsx', 'csv', 'pptx', 'png', 'mp4', 'zip', 'txt', 'exe'].map(fileCategory),
    ['pdf', 'document', 'spreadsheet', 'spreadsheet', 'presentation', 'image', 'video', 'archive', 'text', 'other']);
  assert.deepEqual(['png', 'pdf', 'mp4', 'txt', 'csv', 'docx', 'zip', 'PNG'].map(previewKind),
    ['image', 'pdf', 'video', 'text', 'text', null, null, 'image']);
  // every allowed format has a MIME type and a non-"other" category
  for (const ext of Object.keys(MIME_BY_EXT)) assert.notEqual(fileCategory(ext), 'other', ext);
  assert.ok(Object.keys(EXTENSIONS_BY_CATEGORY).every((c) => CATEGORIES.includes(c)));
});

// ------------------------------------------------------------------------ dto
test('toFileDTO / toFolderDTO produce the documented shape', () => {
  const file = { id: 'f1', name: 'a.png', extension: 'png', mimeType: 'image/png', size: 5n, ownerId: 'u1', folderId: null,
    createdAt: new Date(0), updatedAt: new Date(0), passwordHash: 'leak?', owner: { id: 'u1', name: 'Ada', email: 'a@b.co' } };
  const dto = toFileDTO(file, { starred: true, versionCount: 3 });
  assert.deepEqual(Object.keys(dto).sort(), [
    'access', 'category', 'createdAt', 'currentVersion', 'deletedAt', 'extension', 'folderId', 'id', 'kind', 'lastAccessedAt',
    'mimeType', 'name', 'owner', 'ownerId', 'shared', 'size', 'starred', 'updatedAt', 'versionCount',
  ]);
  assert.deepEqual(dto.owner, { id: 'u1', name: 'Ada' }); // email is not exposed
  assert.equal(dto.category, 'image');
  assert.equal(dto.currentVersion, 3);
  assert.equal(dto.access, undefined);

  const actor = { id: 'u2', permissions: new Set(['file:read', 'file:download']) };
  const withAccess = toFileDTO(file, { actor, access: { level: 'VIEWER', canDownload: true, source: 'file-share' }, sharedBy: { id: 'u1', name: 'Ada', email: 'x' } });
  assert.equal(withAccess.access.level, 'VIEWER');
  assert.equal(withAccess.access.capabilities.read, true);
  assert.equal(withAccess.access.capabilities.update, false);
  assert.deepEqual(withAccess.sharedBy, { id: 'u1', name: 'Ada' });

  const folder = toFolderDTO({ id: 'd1', name: 'Docs', ownerId: 'u1', parentId: null, createdAt: new Date(0), updatedAt: new Date(0) }, { itemCount: 4 });
  assert.equal(folder.kind, 'folder');
  assert.equal(folder.itemCount, 4);
  assert.equal(folder.owner, null);
});

test('toActivityDTO exposes the actor as {id,name} only', () => {
  const dto = toActivityDTO({ id: 'a1', action: 'LOGIN', description: 'x', user: { id: 'u', name: 'N', email: 'e' }, ip: '1.1.1.1', createdAt: new Date(0), userAgent: 'ua' });
  assert.deepEqual(dto.user, { id: 'u', name: 'N' });
  assert.ok(!('userAgent' in dto));
});

// ------------------------------------------------------- notification service
function notifWorld({ prefs = {}, failCreate = false } = {}) {
  const rows = [];
  const emitted = [];
  const errors = [];
  const db = {
    user: { findUnique: async ({ where }) => (where.id === 'ghost' ? null : { notificationPrefs: prefs }) },
    notification: {
      create: async ({ data }) => {
        if (failCreate) throw new Error('db down');
        const row = { id: `n${rows.length + 1}`, readAt: null, createdAt: new Date(0), ...data };
        rows.push(row);
        return row;
      },
      count: async () => rows.filter((r) => !r.readAt).length,
    },
  };
  const svc = createNotificationService({ db, emit: (...a) => emitted.push(a), logger: { error: (...a) => errors.push(a) } });
  return { svc, rows, emitted, errors };
}

test('notifications are stored and pushed to the user room with the unread count', async () => {
  const { svc, rows, emitted } = notifWorld();
  const dto = await svc.create({ userId: 'u1', type: 'FILE_SHARED', title: 'T', body: 'B', data: { resourceId: 'f1' } });
  assert.equal(rows.length, 1);
  assert.equal(dto.id, 'n1');
  assert.deepEqual(emitted, [['u1', 'notification:new', { notification: dto, unreadCount: 1 }]]);
});

test('muted categories are skipped, SYSTEM is never muted, missing prefs default to on', async () => {
  const prefs = { inApp: { shared: false, uploads: true } };
  const { svc, rows } = notifWorld({ prefs });
  assert.equal(await svc.create({ userId: 'u1', type: 'FILE_SHARED', title: 't', body: 'b' }), null);
  assert.equal(await svc.create({ userId: 'u1', type: 'ACCESS_REVOKED', title: 't', body: 'b' }), null);
  assert.ok(await svc.create({ userId: 'u1', type: 'UPLOAD_COMPLETED', title: 't', body: 'b' }));
  assert.ok(await svc.create({ userId: 'u1', type: 'STORAGE_WARNING', title: 't', body: 'b' })); // quota key absent => on
  assert.ok(await svc.create({ userId: 'u1', type: 'SYSTEM', title: 't', body: 'b' }));
  assert.equal(rows.length, 3);
  assert.equal(isMuted({ inApp: { shared: false } }, 'SYSTEM'), false);
  assert.equal(isMuted({}, 'FILE_SHARED'), false);
  assert.equal(isMuted(undefined, 'FILE_SHARED'), false);
});

test('failures and unknown users never throw into the caller', async () => {
  const failing = notifWorld({ failCreate: true });
  assert.equal(await failing.svc.create({ userId: 'u1', type: 'SYSTEM', title: 't', body: 'b' }), null);
  assert.match(String(failing.errors[0][1]), /db down/);
  const { svc } = notifWorld();
  assert.equal(await svc.create({ userId: 'ghost', type: 'SYSTEM', title: 't', body: 'b' }), null);
});

test('createForMany notifies each distinct user once', async () => {
  const { svc, rows } = notifWorld();
  await svc.createForMany(['a', 'b', 'a'], { type: 'SYSTEM', title: 't', body: 'b' });
  assert.deepEqual(rows.map((r) => r.userId).sort(), ['a', 'b']);
  assert.equal(toNotificationDTO({ id: 1, type: 'SYSTEM', title: 't', body: 'b', createdAt: 0, userId: 'secret' }).userId, undefined);
});

// -------------------------------------------------------------------- realtime
test('emitToUser targets the user room and is a no-op without a server', () => {
  setIo(null);
  assert.equal(emitToUser('u1', 'x', {}), false);
  const sent = [];
  setIo({ to: (room) => ({ emit: (event, payload) => sent.push([room, event, payload]) }) });
  assert.equal(emitToUser('u1', 'notification:new', { a: 1 }), true);
  assert.deepEqual(sent, [['user:u1', 'notification:new', { a: 1 }]]);
  setIo(null);
});
