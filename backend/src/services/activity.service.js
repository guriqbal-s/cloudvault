import prisma from '../config/db.js';
import logger from '../utils/logger.js';
import { createActivityService } from './activity.logic.js';

export const activityService = createActivityService({ db: prisma, logger });
export default activityService;
