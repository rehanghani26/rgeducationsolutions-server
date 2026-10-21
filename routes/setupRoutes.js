/**
 * @file setupRoutes.js
 * @description API routes for the School ERP Setup Wizard.
 *
 * All routes require authentication (protect middleware).
 * reset route requires super-admin role.
 */

import express from 'express';
import { protect } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';
import {
  getSetupStatus,
  completeStep,
  dismissWizard,
  resetWizard,
} from '../controllers/setupController.js';

const router = express.Router();

// GET /api/v1/setup/status — Any authenticated user can view setup progress
router.get('/status', protect, getSetupStatus);

// POST /api/v1/setup/complete-step — Admin marks a flag-based step complete
router.post(
  '/complete-step',
  protect,
  authorize('super-admin', 'school-admin'),
  completeStep
);

// POST /api/v1/setup/dismiss — Admin dismisses the wizard banner
router.post(
  '/dismiss',
  protect,
  authorize('super-admin', 'school-admin'),
  dismissWizard
);

// POST /api/v1/setup/reset — Super admin only: reset all wizard flags
router.post(
  '/reset',
  protect,
  authorize('super-admin'),
  resetWizard
);

export default router;
