// 2. External packages
import express from 'express';

// 5. Middleware
import { protect } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';

// 8. Controllers
import {
  getBudgetBySession,
  getBudgets,
  reviseBudget,
  saveBudget
} from '../controllers/budgetController.js';

const router = express.Router();

router.use(protect);

// GET endpoints (Accessible to Admins, Principal, Accountant)
router.get(
  '/',
  authorize('super-admin', 'school-admin', 'admin', 'principal', 'accountant'),
  getBudgets
);
router.get(
  '/session/:sessionId',
  authorize('super-admin', 'school-admin', 'admin', 'principal', 'accountant'),
  getBudgetBySession
);

// WRITE & REVISION endpoints (Accessible to Super Admin, School Admin, Principal)
router.post(
  '/',
  authorize('super-admin', 'school-admin', 'admin', 'principal'),
  saveBudget
);
router.post(
  '/session/:sessionId/revise',
  authorize('super-admin', 'school-admin', 'admin', 'principal'),
  reviseBudget
);
router.post(
  '/:sessionId/revise',
  authorize('super-admin', 'school-admin', 'admin', 'principal'),
  reviseBudget
);

export default router;
