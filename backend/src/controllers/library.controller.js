import { libraryService } from '../services/drive/drive.service.js';
import { actorOf, metaOf } from '../utils/actor.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok } from '../utils/apiResponse.js';

export const starred = asyncHandler(async (req, res) => ok(res, await libraryService.listStarred(actorOf(req))));
export const star = asyncHandler(async (req, res) =>
  ok(res, await libraryService.star(actorOf(req), req.params.type, req.params.id, metaOf(req))));
export const unstar = asyncHandler(async (req, res) =>
  ok(res, await libraryService.unstar(actorOf(req), req.params.type, req.params.id, metaOf(req))));

export const recent = asyncHandler(async (req, res) =>
  ok(res, { files: await libraryService.recent(actorOf(req), req.query.limit) }));

export const search = asyncHandler(async (req, res) => {
  const { meta, ...data } = await libraryService.search(actorOf(req), req.query);
  return ok(res, data, { meta });
});

export const storage = asyncHandler(async (req, res) => ok(res, await libraryService.storageSummary(actorOf(req))));
