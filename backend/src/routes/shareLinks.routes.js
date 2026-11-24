// Mount at /share-links
import { Router } from 'express';

import * as ctrl from '../controllers/share.controller.js';
import { authenticate } from '../middleware/auth.js';
import { requireAnyPermission } from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import { createLinkBody, linkIdParam, targetParam, updateLinkBody } from '../validators/social.validators.js';

const router = Router();
router.use(authenticate, requireAnyPermission('file:share', 'folder:share'));

router.post('/:type/:id', validate({ params: targetParam, body: createLinkBody }), ctrl.createLink);
router.patch('/:linkId', validate({ params: linkIdParam, body: updateLinkBody }), ctrl.updateLink);
router.delete('/:linkId', validate({ params: linkIdParam }), ctrl.revokeLink);

export default router;
