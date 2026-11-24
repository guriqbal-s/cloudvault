import { env } from './env.js';

// Credentials are required for the httpOnly refresh-token cookie, so the origin must be an
// explicit allow-list (never "*").
export const corsOptions = {
  origin(origin, callback) {
    // No Origin header = same-origin request, curl, server-to-server: allow.
    if (!origin || origin === env.clientUrl) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Disposition', 'Content-Length', 'Content-Range', 'Accept-Ranges'],
  maxAge: 600,
};
