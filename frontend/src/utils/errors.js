// Helpers for the API error envelope: { success:false, error:{ code, message, details? } }.

export const SESSION_ENDING_CODES = new Set([
  'INVALID_TOKEN',
  'SESSION_REVOKED',
  'NO_REFRESH_TOKEN',
  'INVALID_REFRESH_TOKEN',
  'REFRESH_EXPIRED',
  'REFRESH_REUSE_DETECTED',
]);

export const getErrorCode = (err) => err?.response?.data?.error?.code ?? (err?.code === 'ERR_CANCELED' ? 'CANCELED' : err?.response ? 'UNKNOWN' : 'NETWORK_ERROR');

export const getStatus = (err) => err?.response?.status ?? 0;

export const isCanceled = (err) => err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError';

/** A message that is safe to show to people. */
export function getErrorMessage(err, fallback = 'Something went wrong. Please try again.') {
  const apiMessage = err?.response?.data?.error?.message;
  if (apiMessage) return apiMessage;
  if (!err?.response && !isCanceled(err) && (err?.request || err?.message === 'Network Error')) {
    return 'Cannot reach the server. Check your connection and try again.';
  }
  return fallback;
}

/**
 * VALIDATION_ERROR details -> { fieldName: message }. `path` may be a string ('email'),
 * a dotted string or an array; the first segment that is a form field wins.
 */
export function getFieldErrors(err) {
  const details = err?.response?.data?.error?.details;
  const out = {};
  if (!Array.isArray(details)) return out;
  for (const d of details) {
    const path = Array.isArray(d?.path) ? d.path.join('.') : String(d?.path ?? '');
    const key = path || '_form';
    if (!(key in out)) out[key] = d?.message ?? 'Invalid value';
  }
  return out;
}
