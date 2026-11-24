// Aggregates every feature router under /api/v1 (rate-limited; see app.js).
// The unauthenticated /health endpoint is mounted separately in app.js so monitors are
// never rate limited.

import { Router } from 'express';
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import folderRoutes from './folders.routes.js';
import fileRoutes from './files.routes.js';
import trashRoutes from './trash.routes.js';
import starredRoutes from './starred.routes.js';
import recentRoutes from './recent.routes.js';
import searchRoutes from './search.routes.js';
import storageRoutes from './storage.routes.js';
import shareRoutes from './shares.routes.js';
import shareLinkRoutes from './shareLinks.routes.js';
import publicRoutes from './public.routes.js';
import notificationRoutes from './notifications.routes.js';
import activityRoutes from './activity.routes.js';
import dashboardRoutes from './dashboard.routes.js';
import adminRoutes from './admin.routes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/folders', folderRoutes);
router.use('/files', fileRoutes);
router.use('/trash', trashRoutes);
router.use('/starred', starredRoutes);
router.use('/recent', recentRoutes);
router.use('/search', searchRoutes);
router.use('/storage', storageRoutes);
router.use('/shares', shareRoutes);
router.use('/share-links', shareLinkRoutes);
router.use('/public', publicRoutes);
router.use('/notifications', notificationRoutes);
router.use('/activity', activityRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/admin', adminRoutes);

export default router;
