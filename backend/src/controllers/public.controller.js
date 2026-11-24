// Unauthenticated share-link endpoints. The link token (and, for password-protected links,
// the unlock token passed as ?at= or the X-Link-Access header) is the only credential.

import { env } from '../config/env.js';
import { shareLinkService } from '../services/social.service.js';
import { storage } from '../services/storage/index.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok } from '../utils/apiResponse.js';
import { streamObject } from '../utils/sendStream.js';

const INLINE_CSP = `frame-ancestors 'self' ${env.clientUrl}`;
const unlockOf = (req) => req.query.at ?? req.get('x-link-access') ?? undefined;

export const metadata = asyncHandler(async (req, res) => ok(res, await shareLinkService.metadata(req.params.token, unlockOf(req))));

export const unlock = asyncHandler(async (req, res) => ok(res, await shareLinkService.unlock(req.params.token, req.body.password)));

export const browse = asyncHandler(async (req, res) =>
  ok(res, await shareLinkService.browse(req.params.token, unlockOf(req), req.query.folderId)));

const stream = (preview) => asyncHandler(async (req, res) => {
  const d = await shareLinkService.streamTarget(req.params.token, unlockOf(req), { fileId: req.params.fileId, preview });
  return streamObject(req, res, { storage, ...d, inlineCsp: INLINE_CSP });
});

export const download = stream(false);
export const preview = stream(true);
