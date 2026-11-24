import { fileService, versionService } from '../services/drive/drive.service.js';
import { storage } from '../services/storage/index.js';
import { env } from '../config/env.js';
import { stagedFiles } from '../middleware/upload.js';
import { actorOf, metaOf } from '../utils/actor.js';
import asyncHandler from '../utils/asyncHandler.js';
import { created, ok } from '../utils/apiResponse.js';
import { streamObject } from '../utils/sendStream.js';

const INLINE_CSP = `frame-ancestors 'self' ${env.clientUrl}`;

/** Send a prepared delivery ({ target, key, size, ... }) to the client. */
async function deliver(req, res, d) {
  if (d.target.type === 'redirect') return res.redirect(302, d.target.url); // S3 presigned URL
  return streamObject(req, res, { storage, key: d.key, size: d.size, filename: d.filename, mimeType: d.mimeType, disposition: d.disposition, inlineCsp: INLINE_CSP });
}

export const upload = asyncHandler(async (req, res) => {
  const { results } = await fileService.upload(actorOf(req), { folderId: req.body.folderId ?? null, files: stagedFiles(req) }, metaOf(req));
  return ok(res, { results }, { status: results.some((r) => r.ok) ? 201 : 200 });
});

export const get = asyncHandler(async (req, res) => ok(res, { file: await fileService.get(actorOf(req), req.params.id) }));

export const update = asyncHandler(async (req, res) =>
  ok(res, { file: await fileService.update(actorOf(req), req.params.id, req.body, metaOf(req)) }));

export const remove = asyncHandler(async (req, res) => {
  await fileService.remove(actorOf(req), req.params.id, metaOf(req));
  return ok(res, null, { message: 'Moved to the trash' });
});

/** A signed URL is only valid for the purpose it was minted for (checked in the middleware). */
export const download = asyncHandler(async (req, res) =>
  deliver(req, res, await fileService.prepareDelivery(actorOf(req), req.params.id, 'download', metaOf(req))));

export const preview = asyncHandler(async (req, res) =>
  deliver(req, res, await fileService.prepareDelivery(actorOf(req), req.params.id, 'preview', metaOf(req))));

export const accessUrl = asyncHandler(async (req, res) =>
  ok(res, await fileService.createAccessUrl(actorOf(req), req.params.id, req.body.purpose)));

// ---- versions
export const listVersions = asyncHandler(async (req, res) =>
  ok(res, { versions: await versionService.list(actorOf(req), req.params.id) }));

export const uploadVersion = asyncHandler(async (req, res) => {
  const [file] = stagedFiles(req);
  const version = await versionService.upload(actorOf(req), req.params.id, { file, comment: req.body.comment }, metaOf(req));
  return created(res, { version }, { message: 'New version uploaded' });
});

export const restoreVersion = asyncHandler(async (req, res) =>
  created(res, { version: await versionService.restore(actorOf(req), req.params.id, req.params.n, metaOf(req)) }, { message: 'Version restored' }));

export const downloadVersion = asyncHandler(async (req, res) =>
  deliver(req, res, await versionService.prepareDownload(actorOf(req), req.params.id, req.params.n, metaOf(req))));

export const removeVersion = asyncHandler(async (req, res) => {
  await versionService.remove(actorOf(req), req.params.id, req.params.n, metaOf(req));
  return ok(res, null, { message: 'Version deleted' });
});

