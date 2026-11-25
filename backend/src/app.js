// Express application (no listening here; see server.js). Order matters:
//   security headers -> CORS -> parsers -> logging -> health -> rate limit -> API -> 404 -> errors

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import { env } from './config/env.js';
import { corsOptions } from './config/cors.js';
import { API_PREFIX } from './config/constants.js';
import { jsonReplacer } from './utils/serialize.js';
import requestLogger from './middleware/requestLogger.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import healthRoutes from './routes/health.routes.js';
import apiRoutes from './routes/index.js';

export { API_PREFIX };

const app = express();

app.disable('x-powered-by');
// Number of proxy hops in front of the API (nginx, ALB, Caddy...); needed for correct client IPs.
if (env.trustProxy) app.set('trust proxy', env.trustProxy);
app.set('json replacer', jsonReplacer); // Prisma BigInt -> number/string

// This server only returns JSON and file bytes, so the CSP is "nothing may load or run".
// frame-ancestors lets the SPA embed file previews (PDF/image) in an <iframe>; because it
// is allow-listed there, the older X-Frame-Options header is turned off so they cannot conflict.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'self'", env.clientUrl] },
    },
    frameguard: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts: env.isProd,
  })
);
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(cookieParser());
if (!env.isTest) app.use(requestLogger);

app.use(`${API_PREFIX}/health`, healthRoutes);
app.use(API_PREFIX, apiLimiter, apiRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
