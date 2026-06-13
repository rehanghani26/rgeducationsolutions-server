import express from 'express';
import {
  getFees,
  getFeeById,
  getFeeActivity,
  updateFee,
  collectFee,
  getExpenses,
  createExpense,
  exportFees,
} from '../controllers/financeController.js';
import { protect } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';

const router = express.Router();

router.get('/fees/export/csv', protect, authorize('super-admin', 'school-admin', 'accountant', 'principal'), exportFees);
router.get('/fees', protect, getFees);
router.get('/fees/:id/activity', protect, getFeeActivity);
router.get('/fees/:id', protect, getFeeById);
router.put('/fees/:id', protect, authorize('super-admin', 'school-admin', 'accountant'), updateFee);
router.post('/fees/collect', protect, authorize('super-admin', 'school-admin', 'accountant', 'student'), collectFee);
router.get('/expenses', protect, getExpenses);
router.post('/expenses', protect, authorize('super-admin', 'school-admin', 'accountant'), createExpense);

export default router;
