import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getUsageSummary } from '../services/usage.service.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const summary = await getUsageSummary(req.auth!.userId);
  return res.json({ success: true, ...summary });
});

export default router;
