import { Router } from 'express';

import * as ctrl from '../controllers/library.controller.js';
import { authenticate } from '../middleware/auth.js';
import { requireAnyPermission } from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import { searchQuery } from '../validators/drive.validators.js';

const router = Router();
router.get('/', authenticate, requireAnyPermission('file:read', 'folder:read'), validate({ query: searchQuery }), ctrl.search);
export default router;
