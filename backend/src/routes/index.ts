import { Router } from 'express';
import authRoutes from './auth.routes.js';
import contactsRoutes from './contacts.routes.js';
import campaignsRoutes from './campaigns.routes.js';
import usageRoutes from './usage.routes.js';
import messagesRoutes from './messages.routes.js';
import blastRoutes from './blast.routes.js';
import registryRoutes from './registry.routes.js';
import adminRoutes from './admin.routes.js';
import autoReplyRoutes from './auto-reply.routes.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({
    success: true,
    service: 'sendstack-backend',
    plan: 'enterprise',
    priceInr: 5000,
    queue: 'bullmq',
    registry: true,
    admin: true,
    autoReply: true,
  });
});

router.use('/auth', authRoutes);
router.use('/contacts', contactsRoutes);
router.use('/campaigns', campaignsRoutes);
router.use('/usage', usageRoutes);
router.use('/messages', messagesRoutes);
router.use('/blast', blastRoutes);
router.use('/registry', registryRoutes);
router.use('/admin', adminRoutes);
router.use('/auto-reply', autoReplyRoutes);

export default router;
