// Mount at /activity
import { Router } from 'express';

import * as ctrl from '../controllers/notification.controller.js';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import { activityQuery } from '../validators/social.validators.js';

const router = Router();
router.get('/', authenticate, requirePermission('activity:read-own'), validate({ query: activityQuery }), ctrl.ownActivity);
export default router;
