import express from 'express';
import {
  getResults,
  getStudentResults,
  getStudentExamResult,
  getClassResults,
  getExamStats,
  bulkUpsertResults,
  publishResults,
  updateResult,
  deleteResult,
} from '../controllers/resultController.js';
import { protect } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';

const router = express.Router();

const ADMIN_ROLES = ['super-admin', 'school-admin', 'principal', 'head-teacher'];
const TEACHER_ROLES = [...ADMIN_ROLES, 'teacher'];

// ─── View Results ──────────────────────────────────────────────────────────────
// All results (admin/teacher)
router.get('/', protect, authorize(...TEACHER_ROLES), getResults);

// Student's full result history (student, parent, teacher, admin)
router.get('/student/:studentId', protect, getStudentResults);

// Single student + exam result
router.get('/exam/:examId/student/:studentId', protect, getStudentExamResult);

// All results for a class in an exam (teacher/admin)
router.get('/exam/:examId/class/:classId', protect, authorize(...TEACHER_ROLES), getClassResults);

// Exam analytics/stats
router.get('/stats/:examId', protect, authorize(...TEACHER_ROLES), getExamStats);

// ─── Enter / Edit Results ──────────────────────────────────────────────────────
// Bulk upsert (teacher submits marks for all students in a class)
router.post('/bulk', protect, authorize(...TEACHER_ROLES), bulkUpsertResults);

// Update single result
router.put('/:id', protect, authorize(...TEACHER_ROLES), updateResult);

// ─── Publish / Delete ──────────────────────────────────────────────────────────
// Publish all results for a class exam (admin/principal only)
router.put('/exam/:examId/class/:classId/publish', protect, authorize(...ADMIN_ROLES), publishResults);

// Delete result (admin only)
router.delete('/:id', protect, authorize(...ADMIN_ROLES), deleteResult);

export default router;
