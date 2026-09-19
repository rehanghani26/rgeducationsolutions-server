import express from 'express';
import {
  getExams,
  getExamById,
  getExamActivity,
  createExam,
  updateExam,
  deleteExam,
} from '../controllers/examController.js';
import { protect } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';

const router = express.Router();

router.get('/', protect, getExams);
router.get('/:id/activity', protect, getExamActivity);
router.get('/:id', protect, getExamById);
router.post('/', protect, authorize('super-admin', 'school-admin', 'admin', 'principal', 'teacher', 'head-teacher', 'director', 'hod', 'coordinator'), createExam);
router.put('/:id', protect, authorize('super-admin', 'school-admin', 'admin', 'principal', 'teacher', 'head-teacher', 'director', 'hod', 'coordinator'), updateExam);
router.delete('/:id', protect, authorize('super-admin', 'school-admin', 'admin', 'principal'), deleteExam);

export default router;
