// Production wiring of the access logic: the real Prisma client.
// Import this from controllers and other services; tests import access.logic.js instead.

import prisma from '../config/db.js';
import { createAccessService } from './access.logic.js';

export * from './access.logic.js';
export const accessService = createAccessService({ db: prisma });
export default accessService;
