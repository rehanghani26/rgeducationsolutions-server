import express from 'express';
import {
  getTeachers,
  getTeacherById,
  getTeacherActivity,
  createTeacher,
  updateTeacher,
  deactivateTeacher,
  resetTeacherPassword,
  deleteTeacher,
  bulkDeleteTeachers,
  exportTeachers,
  getAllLeaves,
  requestLeave,
  reviewLeave,
  getMyLeaves,
} from '../controllers/teacherController.js';
import { protect } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';

const router = express.Router();

router.get('/export/csv', protect, authorize('super-admin', 'school-admin', 'principal'), exportTeachers);
router.get('/', protect, getTeachers);

// Leaves management (Registered above /:id parameter matching route to prevent route clashing)
router.get('/leaves/all', protect, authorize('super-admin', 'school-admin', 'principal'), getAllLeaves);
router.get('/leaves/my', protect, authorize('teacher', 'head-teacher', 'hod', 'coordinator'), getMyLeaves);
router.post('/leaves/request', protect, authorize('teacher', 'head-teacher', 'hod', 'coordinator'), requestLeave);
router.patch('/:teacherId/leaves/:leaveId', protect, authorize('super-admin', 'school-admin', 'principal'), reviewLeave);

router.get('/:id/activity', protect, getTeacherActivity);
router.get('/:id', protect, getTeacherById);
router.post('/bulk-delete', protect, authorize('super-admin', 'school-admin'), bulkDeleteTeachers);
router.post('/', protect, authorize('super-admin', 'school-admin', 'principal'), createTeacher);
router.put('/:id', protect, authorize('super-admin', 'school-admin', 'principal'), updateTeacher);
router.patch('/:id/deactivate', protect, authorize('super-admin', 'school-admin', 'principal'), deactivateTeacher);
router.patch('/:id/reset-password', protect, authorize('super-admin', 'school-admin', 'principal'), resetTeacherPassword);
router.delete('/:id', protect, authorize('super-admin', 'school-admin'), deleteTeacher);

export default router;
