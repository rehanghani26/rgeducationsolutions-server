import express from 'express';
import { protect }   from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';
import {
  // ── CRUD ────────────────────────────────────────────────────────────────────
  getClassRooms,
  getClassRoomsBySession,
  getClassRoomById,
  createClassRoom,
  updateClassRoom,
  deleteClassRoom,
  // ── Class Teacher ───────────────────────────────────────────────────────────
  assignClassTeacher,
  removeClassTeacher,
  getClassTeacherHistory,
  getTeacherClassHistory,
  // ── Student Enrollment ──────────────────────────────────────────────────────
  enrollStudents,
  removeStudent,
  getClassStudents,
  // ── Timetable ───────────────────────────────────────────────────────────────
  assignTimetable,
  getClassTimetable,
  // ── History & Promote ───────────────────────────────────────────────────────
  getStudentFullHistory,
  promoteClassRoom,
} from '../controllers/classController.js';

const router = express.Router();

// ── IMPORTANT: specific paths MUST come before wildcard /:id routes ──────────

// History & session-level lookups
router.get('/session/:sessionId',              protect, getClassRoomsBySession);
router.get('/student/:studentId/history',      protect, getStudentFullHistory);
router.get('/teacher/:teacherId/class-history', protect, getTeacherClassHistory);

// Classroom CRUD
router.get('/',    protect, getClassRooms);
router.get('/:id', protect, getClassRoomById);

router.post(
  '/',
  protect,
  authorize('super-admin', 'school-admin', 'principal', 'admin'),
  createClassRoom
);

router.put(
  '/:id',
  protect,
  authorize('super-admin', 'school-admin', 'principal', 'admin'),
  updateClassRoom
);

router.delete(
  '/:id',
  protect,
  authorize('super-admin', 'school-admin', 'admin'),
  deleteClassRoom
);

// Class Teacher
router.patch(
  '/:id/assign-teacher',
  protect,
  authorize('super-admin', 'school-admin', 'principal', 'admin'),
  assignClassTeacher
);
router.patch(
  '/:id/remove-teacher',
  protect,
  authorize('super-admin', 'school-admin', 'principal', 'admin'),
  removeClassTeacher
);
router.get('/:id/teacher-history', protect, getClassTeacherHistory);

// Students
router.get(
  '/:id/students',
  protect,
  getClassStudents
);
router.post(
  '/:id/enroll',
  protect,
  authorize('super-admin', 'school-admin', 'principal', 'admin'),
  enrollStudents
);
router.delete(
  '/:id/students/:studentId',
  protect,
  authorize('super-admin', 'school-admin', 'principal', 'admin'),
  removeStudent
);

// Timetable
router.get('/:id/timetable', protect, getClassTimetable);
router.patch(
  '/:id/assign-timetable',
  protect,
  authorize('super-admin', 'school-admin', 'principal', 'admin'),
  assignTimetable
);

// Promote
router.post(
  '/:id/promote',
  protect,
  authorize('super-admin', 'school-admin', 'principal'),
  promoteClassRoom
);

export default router;
