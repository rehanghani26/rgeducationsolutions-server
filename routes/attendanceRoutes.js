import express from 'express';
import {
  getAttendanceRecords,
  getAttendanceById,
  createAttendance,
  getAttendanceStats,
  getMyAttendance,
} from '../controllers/attendanceController.js';
import { protect } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';

const router = express.Router();

router.get('/my-attendance', protect, getMyAttendance);
router.get('/stats', protect, getAttendanceStats);
router.get('/', protect, getAttendanceRecords);
router.get('/:id', protect, getAttendanceById);
router.post('/', protect, authorize('super-admin', 'school-admin', 'principal', 'teacher', 'head-teacher'), createAttendance);

export default router;
