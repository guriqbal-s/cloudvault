import { Router } from 'express';

import * as ctrl from '../controllers/file.controller.js';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';
import { authenticateOrSigned } from '../middleware/driveAuth.js';
import { uploadFiles, uploadSingle } from '../middleware/upload.js';
import validate from '../middleware/validate.js';
import {
  accessUrlBody, idParam, updateFileBody, uploadBody, versionParam, versionUploadBody,
} from '../validators/drive.validators.js';

const router = Router();

// Streams: Bearer token OR a signed ?st= URL (for <img>/<video>/<iframe>). Declared before the
// blanket authenticate below so the signed path is not rejected for lacking a header.
router.get('/:id/download', validate({ params: idParam }), authenticateOrSigned('download'), requirePermission('file:download'), ctrl.download);
router.get('/:id/preview', validate({ params: idParam }), authenticateOrSigned('preview'), requirePermission('file:read'), ctrl.preview);

router.use(authenticate);

// Authenticate first (above), so anonymous callers cannot make the server stage files on disk.
router.post('/upload', requirePermission('file:upload'), uploadFiles, validate({ body: uploadBody }), ctrl.upload);

router.get('/:id', requirePermission('file:read'), validate({ params: idParam }), ctrl.get);
router.patch('/:id', requirePermission('file:update'), validate({ params: idParam, body: updateFileBody }), ctrl.update);
router.delete('/:id', requirePermission('file:delete'), validate({ params: idParam }), ctrl.remove);
router.post('/:id/access-url', requirePermission('file:read'), validate({ params: idParam, body: accessUrlBody }), ctrl.accessUrl);

router.get('/:id/versions', requirePermission('version:read'), validate({ params: idParam }), ctrl.listVersions);
router.post('/:id/versions', requirePermission('version:create'), validate({ params: idParam }), uploadSingle, validate({ body: versionUploadBody }), ctrl.uploadVersion);
router.post('/:id/versions/:n/restore', requirePermission('version:restore'), validate({ params: versionParam }), ctrl.restoreVersion);
router.get('/:id/versions/:n/download', requirePermission('version:read'), validate({ params: versionParam }), ctrl.downloadVersion);
router.delete('/:id/versions/:n', requirePermission('version:delete'), validate({ params: versionParam }), ctrl.removeVersion);

export default router;
