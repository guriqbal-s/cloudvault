// Multer configuration: uploads are staged on disk (never held in memory) in storage/tmp, then
// moved into the storage provider by the service layer. Oversized files are rejected while
// streaming, so a huge upload cannot fill the disk.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';

import { env } from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import { fixFilenameEncoding } from '../utils/names.js';

export const MAX_FILES_PER_REQUEST = 20;

fs.mkdirSync(env.storage.tmpDir, { recursive: true });

const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, env.storage.tmpDir),
  filename: (_req, _file, cb) => cb(null, `upload-${crypto.randomBytes(12).toString('hex')}`), // client names never touch the disk path
});

const instance = multer({
  storage: diskStorage,
  limits: { fileSize: env.storage.maxUploadBytes, files: MAX_FILES_PER_REQUEST, fields: 10, parts: MAX_FILES_PER_REQUEST + 10 },
});

/** Translate Multer errors into the API's error envelope. */
function wrap(handler) {
  return (req, res, next) => handler(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new ApiError(413, 'FILE_TOO_LARGE', `A file is larger than the ${Math.floor(env.storage.maxUploadBytes / 1048576)} MB limit`));
      }
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(ApiError.validation(`Upload at most ${MAX_FILES_PER_REQUEST} files at a time, using the "files" field`));
      }
      return next(ApiError.badRequest(err.message));
    }
    return next(err);
  });
}

/** multipart field "files" (1..20) plus text fields such as folderId */
export const uploadFiles = wrap(instance.array('files', MAX_FILES_PER_REQUEST));
/** multipart field "file" (one) plus text fields such as comment */
export const uploadSingle = wrap(instance.single('file'));

/** Normalise Multer files into what the service layer expects. */
export function stagedFiles(req) {
  const list = req.files ?? (req.file ? [req.file] : []);
  return list.map((f) => ({ path: f.path, originalName: fixFilenameEncoding(f.originalname), size: f.size }));
}
