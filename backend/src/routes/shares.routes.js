// Mount at /shares
import { Router } from 'express';

import * as ctrl from '../controllers/share.controller.js';
import { authenticate } from '../middleware/auth.js';
import { requireAnyPermission } from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import { grantBody, shareUserParam, targetParam, updateShareBody } from '../validators/social.validators.js';

const router = Router();
router.use(authenticate);

// Listings first, so "with-me" / "by-me" are never read as a :type.
router.get('/with-me', requireAnyPermission('file:read', 'folder:read'), ctrl.withMe);
router.get('/by-me', requireAnyPermission('file:read', 'folder:read'), ctrl.byMe);

// The owner-only and file:share / folder:share checks happen in the access layer.
router.get('/:type/:id', validate({ params: targetParam }), ctrl.list);
router.post('/:type/:id', validate({ params: targetParam, body: grantBody }), ctrl.grant);
router.patch('/:type/:id/:userId', validate({ params: shareUserParam, body: updateShareBody }), ctrl.update);
router.delete('/:type/:id/:userId', validate({ params: shareUserParam }), ctrl.revoke);

export default router;
