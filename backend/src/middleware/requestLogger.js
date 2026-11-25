import crypto from 'node:crypto';
import logger, { logContext } from '../utils/logger.js';

// Gives every request an id, returns it as X-Request-Id and logs one line when it finishes.
// An incoming X-Request-Id (set by a load balancer or proxy) is reused when it looks sane, so
// one request can be followed through every hop. Logs the path only (never the query string),
// because query strings can carry tokens or search terms.
const VALID_ID = /^[A-Za-z0-9._-]{8,128}$/;

export default function requestLogger(req, res, next) {
  const incoming = req.get('x-request-id');
  const requestId = incoming && VALID_ID.test(incoming) ? incoming : crypto.randomUUID();
  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);

  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const line = `${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${ms.toFixed(1)}ms`;
    logContext.run({ requestId }, () => {
      if (res.statusCode >= 500) logger.error(line);
      else if (res.statusCode >= 400) logger.warn(line);
      else if (!req.originalUrl.startsWith('/api/v1/health')) logger.info(line); // skip probe noise
    });
  });
  logContext.run({ requestId }, next);
}
