import prisma from '../config/db.js';
import logger from '../utils/logger.js';
import { createNotificationService } from './notification.logic.js';
import { emitToUser } from './realtime.js';

export const notificationService = createNotificationService({ db: prisma, emit: emitToUser, logger });
export default notificationService;
