import asyncHandler from '../utils/asyncHandler.js';
import { checkHealth } from '../services/health.service.js';

// Public, unauthenticated: used by load balancers and uptime monitors. Exposes only
// up/down flags, never error text or versions.
export const getHealth = asyncHandler(async (_req, res) => {
  const { ok, ...report } = await checkHealth();
  return res.status(ok ? 200 : 503).json({ success: ok, data: report });
});

export const getLiveness = (_req, res) => res.status(200).json({ success: true, data: { status: 'ok' } });
