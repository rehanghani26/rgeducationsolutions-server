import express from 'express';
import {
  getHomework,
  getHomeworkById,
  getHomeworkActivity,
  createHomework,
  updateHomework,
  deleteHomework,
  submitHomework,
  gradeSubmission,
} from '../controllers/homeworkController.js';
import { protect } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';

const router = express.Router();

// ─── Read (all authenticated users) ─────────────────────────────────────────
router.get('/', protect, getHomework);
router.get('/:id/activity', protect, getHomeworkActivity);
router.get('/:id', protect, getHomeworkById);

// ─── Write (admin + teaching roles) ─────────────────────────────────────────
router.post(
  '/',
  protect,
  authorize('super-admin', 'school-admin', 'principal', 'teacher', 'head-teacher', 'hod', 'coordinator'),
  createHomework
);
router.put(
  '/:id',
  protect,
  authorize('super-admin', 'school-admin', 'principal', 'teacher', 'head-teacher', 'hod', 'coordinator'),
  updateHomework
);
router.delete(
  '/:id',
  protect,
  authorize('super-admin', 'school-admin', 'principal'),
  deleteHomework
);

// ─── Student submit ──────────────────────────────────────────────────────────
router.post('/:id/submit', protect, authorize('student'), submitHomework);

// ─── Teacher/admin grade submission ─────────────────────────────────────────
router.put(
  '/:id/grade/:submId',
  protect,
  authorize('super-admin', 'school-admin', 'principal', 'teacher', 'head-teacher', 'hod', 'coordinator'),
  gradeSubmission
);

export default router;
