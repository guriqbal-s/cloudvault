// Mount at /admin. admin:access opens the panel; each endpoint also needs its own permission,
// and the service enforces role-rank rules on top (see services/admin.logic.js).
import { Router } from 'express';

import * as ctrl from '../controllers/admin.controller.js';
import { authenticate } from '../middleware/auth.js';
import { requireAnyPermission, requirePermission } from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import {
  adminActivityQuery, adminUsersQuery, createUserBody, deleteUserQuery, idParam, pagingQuery,
  rankingQuery, rolesBody, updateUserBody,
} from '../validators/social.validators.js';

const router = Router();
router.use(authenticate, requirePermission('admin:access'));

router.get('/stats', requirePermission('admin:analytics'), ctrl.stats);
router.get('/storage', requirePermission('admin:analytics'), validate({ query: rankingQuery }), ctrl.storage);

router.get('/users', requirePermission('user:read'), validate({ query: adminUsersQuery }), ctrl.listUsers);
router.post('/users', requirePermission('user:manage'), validate({ body: createUserBody }), ctrl.createUser);
router.get('/users/:id', requirePermission('user:read'), validate({ params: idParam }), ctrl.getUser);
router.patch('/users/:id', requireAnyPermission('user:manage', 'user:suspend', 'user:quota'), validate({ params: idParam, body: updateUserBody }), ctrl.updateUser);
router.put('/users/:id/roles', requirePermission('user:assign-role'), validate({ params: idParam, body: rolesBody }), ctrl.setRoles);
router.delete('/users/:id', requirePermission('user:manage'), validate({ params: idParam, query: deleteUserQuery }), ctrl.removeUser);
router.post('/users/:id/revoke-sessions', requirePermission('user:manage'), validate({ params: idParam }), ctrl.revokeSessions);

router.get('/roles', requirePermission('user:read'), ctrl.roles);
router.get('/activity', requirePermission('activity:read-all'), validate({ query: adminActivityQuery }), ctrl.activity);

router.get('/shares', requirePermission('admin:monitor-sharing'), validate({ query: pagingQuery }), ctrl.links);
router.delete('/shares/links/:id', requirePermission('admin:monitor-sharing'), validate({ params: idParam }), ctrl.revokeLink);

export default router;
