// Central error handling. Anything thrown or passed to next(err) ends up here and leaves as
// { success: false, error: { code, message, details? } }. Unexpected errors never leak internals.

import ApiError from '../utils/ApiError.js';
import logger from '../utils/logger.js';

export function notFound(req, _res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl.split('?')[0]}`));
}

/** Maps known third-party errors to ApiError. Duck-typed so this file has no hard dependencies. */
export function normalizeError(err) {
  if (err instanceof ApiError) return err;

  // Zod
  if (err?.name === 'ZodError' && Array.isArray(err.issues)) {
    return ApiError.validation(
      'Validation failed',
      err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
    );
  }

  // Malformed JSON body (body-parser)
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return ApiError.badRequest('Request body is not valid JSON');
  }
  if (err?.type === 'entity.too.large') return ApiError.payloadTooLarge('Request body too large');

  // Multer
  if (err?.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') return ApiError.payloadTooLarge('File is larger than the allowed size');
    if (err.code === 'LIMIT_FILE_COUNT') return ApiError.badRequest('Too many files in one upload');
    if (err.code === 'LIMIT_UNEXPECTED_FILE') return ApiError.badRequest('Unexpected file field');
    return ApiError.badRequest(err.message);
  }

  // Prisma known request errors
  if (err?.name === 'PrismaClientKnownRequestError') {
    switch (err.code) {
      case 'P2002':
        return ApiError.conflict('A record with the same unique value already exists', { fields: err.meta?.target });
      case 'P2003':
        return ApiError.conflict('This record is referenced by other data');
      case 'P2025':
        return ApiError.notFound('Record not found');
      default:
        return null; // unexpected database error: treat as 500
    }
  }

  // Local storage layer
  if (err?.name === 'StorageError') {
    if (err.code === 'NOT_FOUND') return ApiError.notFound('Stored file content not found');
    if (err.code === 'INVALID_KEY') return ApiError.badRequest('Invalid storage key');
  }

  return null;
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  const known = normalizeError(err);
  const apiError = known ?? ApiError.internal();

  if (!known) {
    logger.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, err);
  } else if (apiError.statusCode >= 500) {
    logger.error(`${apiError.code} on ${req.method} ${req.originalUrl}:`, err);
  }

  if (res.headersSent) return res.end();

  const body = { success: false, error: { code: apiError.code, message: apiError.message } };
  if (apiError.details !== undefined) body.error.details = apiError.details;
  return res.status(apiError.statusCode).json(body);
}
