import { accessService } from '../services/access.service.js';
import { folderService } from '../services/drive/drive.service.js';
import { actorOf, metaOf } from '../utils/actor.js';
import asyncHandler from '../utils/asyncHandler.js';
import { created, ok } from '../utils/apiResponse.js';
import ApiError from '../utils/ApiError.js';

const contents = (folderId) => asyncHandler(async (req, res) => {
  const { meta, ...data } = await folderService.contents(actorOf(req), folderId ?? req.params.id, req.query);
  return ok(res, data, { meta });
});

export const root = contents(null);
export const show = contents(undefined);

export const create = asyncHandler(async (req, res) =>
  created(res, { folder: await folderService.create(actorOf(req), req.body, metaOf(req)) }, { message: 'Folder created' }));

export const update = asyncHandler(async (req, res) =>
  ok(res, { folder: await folderService.update(actorOf(req), req.params.id, req.body, metaOf(req)) }));

export const remove = asyncHandler(async (req, res) => {
  await folderService.remove(actorOf(req), req.params.id, metaOf(req));
  return ok(res, null, { message: 'Moved to the trash' });
});

/** Zip download needs an archiver dependency; the contract allows 501 until it is added. */
export const download = asyncHandler(async (req, res, next) => {
  // Still enforce access so the response never reveals more than a 404/403 would.
  await accessService.requireFolderAccess(actorOf(req), req.params.id, 'download');
  return next(new ApiError(501, 'NOT_IMPLEMENTED', 'Downloading a whole folder is not available yet'));
});

