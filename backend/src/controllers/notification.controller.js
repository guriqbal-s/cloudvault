// Notifications, own activity and dashboard.
import { activityQuery, dashboardService, notificationService } from '../services/social.service.js';
import { actorOf } from '../utils/actor.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok, paginated } from '../utils/apiResponse.js';

export const list = asyncHandler(async (req, res) => {
  const { items, meta } = await notificationService.list(req.user.user.id, { unread: req.query.unread, page: req.query.page, limit: req.query.limit });
  return paginated(res, { notifications: items }, meta);
});
export const markRead = asyncHandler(async (req, res) => ok(res, await notificationService.markRead(req.user.user.id, req.params.id)));
export const markAllRead = asyncHandler(async (req, res) => ok(res, await notificationService.markAllRead(req.user.user.id)));
export const remove = asyncHandler(async (req, res) => ok(res, await notificationService.remove(req.user.user.id, req.params.id), { message: 'Notification deleted' }));

export const ownActivity = asyncHandler(async (req, res) => {
  const { page, limit, ...filters } = req.query;
  const { items, meta } = await activityQuery.listOwn(req.user.user.id, filters, { page, limit });
  return paginated(res, { activity: items }, meta);
});

export const dashboard = asyncHandler(async (req, res) => ok(res, await dashboardService.forUser(actorOf(req))));
