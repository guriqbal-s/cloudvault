// Production wiring of the social / admin modules: Prisma, bcrypt, real storage and Socket.IO.
// Controllers import from here; tests import the *.logic.js factories with fakes instead.

import bcrypt from 'bcrypt';

import prisma from '../config/db.js';
import { env } from '../config/env.js';
import logger from '../utils/logger.js';
import { randomToken } from '../utils/crypto.js';
import { createHmacTokens } from '../utils/hmacToken.js';
import { accessService } from './access.service.js';
import { activityService } from './activity.service.js';
import { createActivityQueryService } from './activityQuery.logic.js';
import { createAdminService } from './admin.logic.js';
import { createDashboardService } from './dashboard.logic.js';
import { notificationService } from './notification.service.js';
import { createProfileService } from './profile.logic.js';
import { createShareLinkService } from './shareLinks.logic.js';
import { createShareService } from './shares.logic.js';
import { storage } from './storage/index.js';

const hasher = {
  hash: (plain) => bcrypt.hash(plain, env.auth.bcryptRounds),
  compare: (plain, hash) => bcrypt.compare(plain, hash),
};

export const shareService = createShareService({
  db: prisma, access: accessService, notifications: notificationService, activity: activityService, clientUrl: env.clientUrl,
});

export const shareLinkService = createShareLinkService({
  db: prisma, access: accessService, hasher, randomToken,
  unlockTokens: createHmacTokens({ secret: env.auth.accessSecret, purpose: 'share-link-unlock' }),
  activity: activityService, clientUrl: env.clientUrl,
});

export const activityQuery = createActivityQueryService({ db: prisma });
export const dashboardService = createDashboardService({ db: prisma });
export const profileService = createProfileService({ db: prisma, storage, activity: activityService, logger });
export const adminService = createAdminService({
  db: prisma, hasher, storage, activity: activityService, notifications: notificationService,
  defaultQuotaBytes: env.storage.defaultQuotaBytes, logger,
});
export { notificationService };
