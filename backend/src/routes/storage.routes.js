import { Router } from 'express';

import * as ctrl from '../controllers/library.controller.js';
import { authenticate } from '../middleware/auth.js';
import { requireAnyPermission } from '../middleware/authorize.js';

const router = Router();
router.get('/', authenticate, requireAnyPermission('file:read', 'folder:read'), ctrl.storage);
export default router;
