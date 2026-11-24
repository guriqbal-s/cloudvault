// Mount at /dashboard
import { Router } from 'express';

import * as ctrl from '../controllers/notification.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.get('/', authenticate, ctrl.dashboard);
export default router;
