import { Router } from 'express';

import * as ctrl from '../controllers/library.controller.js';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import { recentQuery } from '../validators/drive.validators.js';

const router = Router();
router.get('/', authenticate, requirePermission('file:read'), validate({ query: recentQuery }), ctrl.recent);
export default router;
