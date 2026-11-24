import { Router } from 'express';

import * as ctrl from '../controllers/user.controller.js';
import { authenticate } from '../middleware/auth.js';
import { uploadAvatar } from '../middleware/avatarUpload.js';
import { requireAnyPermission } from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import { changePasswordSchema, idParamSchema } from '../validators/auth.validators.js';
import { lookupQuery, preferencesBody, updateProfileBody } from '../validators/social.validators.js';

const router = Router();

router.use(authenticate); // every /users route requires a signed-in user

router.get('/me', ctrl.me);
router.patch('/me', validate({ body: updateProfileBody }), ctrl.updateProfile);
router.patch('/me/preferences', validate({ body: preferencesBody }), ctrl.updatePreferences);
router.post('/me/avatar', uploadAvatar, ctrl.setAvatar);
router.get('/me/avatar', ctrl.avatar);
router.delete('/me/avatar', ctrl.removeAvatar);
router.get('/lookup', requireAnyPermission('file:share', 'folder:share'), validate({ query: lookupQuery }), ctrl.lookup);

router.patch('/me/password', validate({ body: changePasswordSchema }), ctrl.changePassword);
router.get('/me/sessions', ctrl.listSessions);
router.delete('/me/sessions', ctrl.revokeOtherSessions);
router.delete('/me/sessions/:id', validate({ params: idParamSchema }), ctrl.revokeSession);

// Declared last: ':id' must never shadow the /me/* routes above.
router.get('/:id/avatar', validate({ params: idParamSchema }), ctrl.avatar);

export default router;
