import { activityQuery, adminService } from '../services/social.service.js';
import { actorOf, metaOf } from '../utils/actor.js';
import asyncHandler from '../utils/asyncHandler.js';
import { created, ok, paginated } from '../utils/apiResponse.js';

export const stats = asyncHandler(async (_req, res) => ok(res, await adminService.stats()));

export const listUsers = asyncHandler(async (req, res) => {
  const { items, meta } = await adminService.listUsers(req.query);
  return paginated(res, { users: items }, meta);
});
export const getUser = asyncHandler(async (req, res) => ok(res, { user: await adminService.getUser(req.params.id) }));
export const createUser = asyncHandler(async (req, res) =>
  created(res, { user: await adminService.createUser(actorOf(req), req.body, metaOf(req)) }, { message: 'User created' }));
export const updateUser = asyncHandler(async (req, res) =>
  ok(res, { user: await adminService.updateUser(actorOf(req), req.params.id, req.body, metaOf(req)) }));
export const setRoles = asyncHandler(async (req, res) =>
  ok(res, { user: await adminService.setRoles(actorOf(req), req.params.id, req.body.roleKeys, metaOf(req)) }, { message: 'Roles updated' }));
export const removeUser = asyncHandler(async (req, res) =>
  ok(res, await adminService.removeUser(actorOf(req), req.params.id, { purge: req.query.purge }, metaOf(req)), { message: 'User deleted' }));
export const revokeSessions = asyncHandler(async (req, res) =>
  ok(res, await adminService.revokeSessions(actorOf(req), req.params.id, metaOf(req)), { message: 'Signed out of all devices' }));

export const roles = asyncHandler(async (_req, res) => ok(res, { roles: await adminService.listRoles() }));

export const activity = asyncHandler(async (req, res) => {
  const { page, limit, ...filters } = req.query;
  const { items, meta } = await activityQuery.listAll(filters, { page, limit });
  return paginated(res, { activity: items }, meta);
});

export const storage = asyncHandler(async (req, res) => ok(res, await adminService.storageRanking({ limit: req.query.limit })));

export const links = asyncHandler(async (req, res) => {
  const { items, meta } = await adminService.listLinks(req.query);
  return paginated(res, { links: items }, meta);
});
export const revokeLink = asyncHandler(async (req, res) =>
  ok(res, await adminService.revokeLink(actorOf(req), req.params.id, metaOf(req)), { message: 'Link revoked' }));
