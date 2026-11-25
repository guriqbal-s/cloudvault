// Leveled logger with no dependencies. Quiet during tests.
//
//   LOG_LEVEL   error | warn | info | debug           (default: info; error in tests)
//   LOG_FORMAT  json | pretty                         (default: json in production, pretty otherwise)
//
// JSON output is one object per line on stdout/stderr, which CloudWatch, Loki, Datadog and
// `docker logs` all ingest as-is. Lines written while handling an HTTP request carry its
// requestId (see middleware/requestLogger.js), so one request can be traced across lines.

import { AsyncLocalStorage } from 'node:async_hooks';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const isProd = process.env.NODE_ENV === 'production';
const configured = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'error' : 'info');
const threshold = LEVELS[configured] ?? LEVELS.info;
const json = (process.env.LOG_FORMAT || (isProd ? 'json' : 'pretty')) === 'json';

/** Per-request context ({ requestId }) for every log line written inside it. */
export const logContext = new AsyncLocalStorage();

function serializeError(err) {
  return { name: err.name, message: err.message, ...(err.code ? { code: err.code } : {}), stack: err.stack };
}

function write(level, args) {
  if (LEVELS[level] > threshold) return;
  const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  const ctx = logContext.getStore();

  if (json) {
    const errors = args.filter((a) => a instanceof Error).map(serializeError);
    const msg = args
      .filter((a) => !(a instanceof Error))
      .map((a) => (typeof a === 'string' ? a : safeStringify(a)))
      .join(' ');
    const entry = { time: new Date().toISOString(), level, msg, ...ctx };
    if (errors.length) entry.err = errors.length === 1 ? errors[0] : errors;
    out.write(`${safeStringify(entry)}\n`);
    return;
  }

  const prefix = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)}${ctx?.requestId ? ` [${ctx.requestId}]` : ''}`;
  (out === process.stderr ? console.error : console.log)(prefix, ...args);
}

function safeStringify(value) {
  try {
    return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  } catch {
    return String(value);
  }
}

const logger = {
  error: (...a) => write('error', a),
  warn: (...a) => write('warn', a),
  info: (...a) => write('info', a),
  debug: (...a) => write('debug', a),
};

export default logger;
