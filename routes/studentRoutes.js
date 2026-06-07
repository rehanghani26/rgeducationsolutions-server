import express from 'express';
import {
  getStudents,
  getStudentById,
  getStudentActivity,
  createStudent,
  updateStudent,
  deactivateStudent,
  resetStudentPassword,
  deleteStudent,
  bulkDeleteStudents,
  bulkPromoteStudents,
  exportStudents,
} from '../controllers/studentController.js';
import { protect } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';

const router = express.Router();

router.get('/export/csv', protect, authorize('super-admin', 'school-admin', 'principal'), exportStudents);
router.get('/', protect, getStudents);
router.get('/:id/activity', protect, getStudentActivity);
router.get('/:id', protect, getStudentById);
router.post('/bulk-delete', protect, authorize('super-admin', 'school-admin'), bulkDeleteStudents);
router.post('/bulk-promote', protect, authorize('super-admin', 'school-admin', 'principal'), bulkPromoteStudents);
router.post('/', protect, authorize('super-admin', 'school-admin', 'principal'), createStudent);
router.put('/:id', protect, authorize('super-admin', 'school-admin', 'principal'), updateStudent);
router.patch('/:id/deactivate', protect, authorize('super-admin', 'school-admin', 'principal'), deactivateStudent);
router.patch('/:id/reset-password', protect, authorize('super-admin', 'school-admin', 'principal'), resetStudentPassword);
router.delete('/:id', protect, authorize('super-admin', 'school-admin'), deleteStudent);

export default router;
