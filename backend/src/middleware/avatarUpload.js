// Avatar uploads are small (2 MB) and kept in memory; the service validates the image bytes.
import multer from 'multer';
import ApiError from '../utils/ApiError.js';
import { MAX_AVATAR_BYTES } from '../services/profile.logic.js';

const instance = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_AVATAR_BYTES, files: 1, fields: 2, parts: 4 } });

export const uploadAvatar = (req, res, next) => instance.single('avatar')(req, res, (err) => {
  if (!err) return next();
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return next(ApiError.payloadTooLarge('Profile pictures can be at most 2 MB'));
    return next(ApiError.validation('Upload one image using the "avatar" field'));
  }
  return next(err);
});
