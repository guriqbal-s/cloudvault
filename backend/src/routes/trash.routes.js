import { Router } from 'express';

import * as ctrl from '../controllers/trash.controller.js';
import { authenticate } from '../middleware/auth.js';
import { requireAnyPermission } from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import { typedParam } from '../validators/drive.validators.js';

const router = Router();
router.use(authenticate, requireAnyPermission('file:delete', 'folder:delete'));

router.get('/', ctrl.list);
router.delete('/', ctrl.empty);
router.post('/:type/:id/restore', validate({ params: typedParam }), ctrl.restore);
router.delete('/:type/:id', validate({ params: typedParam }), ctrl.purge);

export default router;
