// Production wiring of the drive logic: Prisma repo, real storage, activity, notifications.
// Controllers import from here; tests import the *.logic.js factories with fakes instead.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';

import { env } from '../../config/env.js';
import prisma from '../../config/db.js';
import logger from '../../utils/logger.js';
import { accessService } from '../access.service.js';
import { activityService } from '../activity.service.js';
import { createAccessTokenService } from '../accessToken.js';
import { notificationService } from '../notification.service.js';
import { storage } from '../storage/index.js';
import { createDriveRepo } from './drive.repo.js';
import { createFileService } from './files.logic.js';
import { createFolderService } from './folders.logic.js';
import { createLibraryService } from './library.logic.js';
import { createDecorator } from './shared.js';
import { createTrashService } from './trash.logic.js';
import { createVersionService } from './versions.logic.js';

const repo = createDriveRepo(prisma);
const decorator = createDecorator({ repo });
const ids = () => crypto.randomUUID();
const removeFile = (p) => fs.rm(p, { force: true });

export const accessTokens = createAccessTokenService({ secret: env.auth.accessSecret });

const common = { repo, access: accessService, storage, activity: activityService, notifications: notificationService, decorator, logger, ids };
const config = {
  allowedExtensions: env.storage.allowedExtensions,
  maxUploadBytes: env.storage.maxUploadBytes,
  quotaWarningPercent: env.storage.quotaWarningPercent,
  trashRetentionDays: env.jobs.trashRetentionDays,
};

export const folderService = createFolderService(common);
export const fileService = createFileService({ ...common, config, removeFile, accessTokens });
export const versionService = createVersionService({ ...common, config, removeFile });
export const trashService = createTrashService({ ...common, config });
export const libraryService = createLibraryService(common);
export const driveRepo = repo;
