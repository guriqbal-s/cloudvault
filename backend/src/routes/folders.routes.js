import { Router } from 'express';

import * as ctrl from '../controllers/folder.controller.js';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import { createFolderBody, idParam, listQuery, updateFolderBody } from '../validators/drive.validators.js';

const router = Router();
router.use(authenticate);

// "root" must be declared before "/:id"
router.get('/root', requirePermission('folder:read'), validate({ query: listQuery }), ctrl.root);
router.get('/:id', requirePermission('folder:read'), validate({ params: idParam, query: listQuery }), ctrl.show);
router.post('/', requirePermission('folder:create'), validate({ body: createFolderBody }), ctrl.create);
router.patch('/:id', requirePermission('folder:update'), validate({ params: idParam, body: updateFolderBody }), ctrl.update);
router.delete('/:id', requirePermission('folder:delete'), validate({ params: idParam }), ctrl.remove);
router.get('/:id/download', requirePermission('file:download'), validate({ params: idParam }), ctrl.download);

export default router;
