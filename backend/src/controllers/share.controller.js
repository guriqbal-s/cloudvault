import { shareLinkService, shareService } from '../services/social.service.js';
import { TYPE_BY_SEGMENT } from '../services/shares.logic.js';
import { actorOf, metaOf } from '../utils/actor.js';
import asyncHandler from '../utils/asyncHandler.js';
import { created, ok } from '../utils/apiResponse.js';

const typeOf = (req) => TYPE_BY_SEGMENT[req.params.type];

export const withMe = asyncHandler(async (req, res) => ok(res, await shareService.withMe(actorOf(req))));
export const byMe = asyncHandler(async (req, res) => ok(res, await shareService.byMe(actorOf(req))));

export const list = asyncHandler(async (req, res) =>
  ok(res, await shareService.listForResource(actorOf(req), typeOf(req), req.params.id)));

export const grant = asyncHandler(async (req, res) =>
  created(res, { share: await shareService.grant(actorOf(req), typeOf(req), req.params.id, req.body, metaOf(req)) }, { message: 'Shared' }));

export const update = asyncHandler(async (req, res) =>
  ok(res, { share: await shareService.update(actorOf(req), typeOf(req), req.params.id, req.params.userId, req.body, metaOf(req)) }));

export const revoke = asyncHandler(async (req, res) => {
  await shareService.revoke(actorOf(req), typeOf(req), req.params.id, req.params.userId, metaOf(req));
  return ok(res, null, { message: 'Access removed' });
});

// ---- links
export const createLink = asyncHandler(async (req, res) =>
  created(res, { link: await shareLinkService.create(actorOf(req), typeOf(req), req.params.id, req.body, metaOf(req)) }, { message: 'Link created' }));

export const updateLink = asyncHandler(async (req, res) =>
  ok(res, { link: await shareLinkService.update(actorOf(req), req.params.linkId, req.body, metaOf(req)) }));

export const revokeLink = asyncHandler(async (req, res) => {
  await shareLinkService.revoke(actorOf(req), req.params.linkId, metaOf(req));
  return ok(res, null, { message: 'Link revoked' });
});
