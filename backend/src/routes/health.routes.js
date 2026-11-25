import { Router } from 'express';
import { getHealth, getLiveness } from '../controllers/health.controller.js';

const router = Router();
// Readiness: database + storage reachable (load balancers, uptime monitors).
router.get('/', getHealth);
router.get('/ready', getHealth);
// Liveness: the process is up and serving HTTP (container health checks). It does not touch
// dependencies, so a short database outage does not get every container restarted at once.
router.get('/live', getLiveness);

export default router;
