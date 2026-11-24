// Mount at /notifications
import { Router } from 'express';

import * as ctrl from '../controllers/notification.controller.js';
import { authenticate } from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import { idParam, notificationsQuery } from '../validators/social.validators.js';

const router = Router();
router.use(authenticate);

router.get('/', validate({ query: notificationsQuery }), ctrl.list);
router.post('/read-all', ctrl.markAllRead);
router.patch('/:id/read', validate({ params: idParam }), ctrl.markRead);
router.delete('/:id', validate({ params: idParam }), ctrl.remove);

export default router;
