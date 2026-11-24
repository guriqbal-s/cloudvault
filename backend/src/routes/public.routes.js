// Mount at /public. No Authorization header: the link token is the credential.
import { Router } from 'express';

import * as ctrl from '../controllers/public.controller.js';
import { loginLimiter } from '../middleware/rateLimiter.js';
import validate from '../middleware/validate.js';
import { publicFileParam, publicQuery, publicTokenParam, unlockBody } from '../validators/social.validators.js';

const router = Router();

router.get('/links/:token', validate({ params: publicTokenParam, query: publicQuery }), ctrl.metadata);
// Only failed unlock attempts count towards the limit (password guessing).
router.post('/links/:token/unlock', loginLimiter, validate({ params: publicTokenParam, body: unlockBody }), ctrl.unlock);
router.get('/links/:token/folder', validate({ params: publicTokenParam, query: publicQuery }), ctrl.browse);
router.get('/links/:token/download', validate({ params: publicTokenParam, query: publicQuery }), ctrl.download);
router.get('/links/:token/preview', validate({ params: publicTokenParam, query: publicQuery }), ctrl.preview);
router.get('/links/:token/files/:fileId/download', validate({ params: publicFileParam, query: publicQuery }), ctrl.download);
router.get('/links/:token/files/:fileId/preview', validate({ params: publicFileParam, query: publicQuery }), ctrl.preview);

export default router;
