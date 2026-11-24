import { Router } from 'express';

import * as ctrl from '../controllers/library.controller.js';
import { authenticate } from '../middleware/auth.js';
import { requireAnyPermission } from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import { typedParam } from '../validators/drive.validators.js';

const router = Router();
router.use(authenticate, requireAnyPermission('file:read', 'folder:read'));

router.get('/', ctrl.starred);
router.put('/:type/:id', validate({ params: typedParam }), ctrl.star);
router.delete('/:type/:id', validate({ params: typedParam }), ctrl.unstar);

export default router;
