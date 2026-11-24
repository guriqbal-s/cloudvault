import { trashService } from '../services/drive/drive.service.js';
import { actorOf, metaOf } from '../utils/actor.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok } from '../utils/apiResponse.js';

export const list = asyncHandler(async (req, res) => ok(res, await trashService.list(actorOf(req))));

export const restore = asyncHandler(async (req, res) => {
  const item = await trashService.restore(actorOf(req), req.params.type, req.params.id, metaOf(req));
  return ok(res, { item }, { message: 'Restored' });
});

export const purge = asyncHandler(async (req, res) => {
  const result = await trashService.purge(actorOf(req), req.params.type, req.params.id, metaOf(req));
  return ok(res, result, { message: 'Deleted permanently' });
});

export const empty = asyncHandler(async (req, res) =>
  ok(res, await trashService.empty(actorOf(req), metaOf(req)), { message: 'Trash emptied' }));
