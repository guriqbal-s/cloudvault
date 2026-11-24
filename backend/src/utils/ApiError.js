// Operational (expected) errors that map cleanly to an HTTP response.
// Services throw these; the central error handler turns them into the standard envelope.

export default class ApiError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(message = 'Bad request', details) {
    return new ApiError(400, 'BAD_REQUEST', message, details);
  }
  static unauthorized(message = 'Authentication required', code = 'UNAUTHORIZED') {
    return new ApiError(401, code, message);
  }
  static forbidden(message = 'You do not have permission to do that', details) {
    return new ApiError(403, 'FORBIDDEN', message, details);
  }
  static notFound(message = 'Resource not found') {
    return new ApiError(404, 'NOT_FOUND', message);
  }
  static conflict(message = 'Conflict', details) {
    return new ApiError(409, 'CONFLICT', message, details);
  }
  static gone(message = 'This resource is no longer available') {
    return new ApiError(410, 'GONE', message);
  }
  static payloadTooLarge(message = 'Payload too large') {
    return new ApiError(413, 'PAYLOAD_TOO_LARGE', message);
  }
  static validation(message = 'Validation failed', details) {
    return new ApiError(422, 'VALIDATION_ERROR', message, details);
  }
  static tooMany(message = 'Too many requests, please try again later') {
    return new ApiError(429, 'RATE_LIMITED', message);
  }
  static quotaExceeded(message = 'Storage quota exceeded') {
    return new ApiError(413, 'QUOTA_EXCEEDED', message);
  }
  static internal(message = 'Internal server error') {
    return new ApiError(500, 'INTERNAL_ERROR', message);
  }
}
