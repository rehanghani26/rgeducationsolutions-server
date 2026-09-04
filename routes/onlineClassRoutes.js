import express from 'express';
import {
  getOnlineClasses,
  getOnlineClassById,
  getOnlineClassActivity,
  createOnlineClass,
  updateOnlineClass,
  deleteOnlineClass,
  joinOnlineClass,
} from '../controllers/onlineClassController.js';
import { protect } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';

const router = express.Router();

// ─── Read (all authenticated users) ─────────────────────────────────────────
router.get('/', protect, getOnlineClasses);
router.get('/:id/activity', protect, getOnlineClassActivity);
router.get('/:id', protect, getOnlineClassById);

// ─── Write (admin + teaching roles) ─────────────────────────────────────────
router.post(
  '/',
  protect,
  authorize('super-admin', 'school-admin', 'principal', 'teacher', 'head-teacher', 'hod', 'coordinator'),
  createOnlineClass
);
router.put(
  '/:id',
  protect,
  authorize('super-admin', 'school-admin', 'principal', 'teacher', 'head-teacher', 'hod', 'coordinator'),
  updateOnlineClass
);
router.delete(
  '/:id',
  protect,
  authorize('super-admin', 'school-admin', 'principal'),
  deleteOnlineClass
);

// ─── Student join action ─────────────────────────────────────────────────────
router.post('/:id/join', protect, authorize('student'), joinOnlineClass);

export default router;
