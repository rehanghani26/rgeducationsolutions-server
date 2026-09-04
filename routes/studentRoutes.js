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
  promoteStudents,
  rollbackPromotion,
  getPromotionStatus,
  bulkImportStudents,
  exportStudents,
  getStudentCredentials,
} from '../controllers/studentController.js';
import { protect } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';

const router = express.Router();

router.get('/export/csv', protect, authorize('super-admin', 'school-admin', 'principal'), exportStudents);
router.get('/promotion-status', protect, getPromotionStatus);
router.get('/', protect, getStudents);
router.get('/:id/credentials', protect, authorize('super-admin'), getStudentCredentials);
router.get('/:id/activity', protect, getStudentActivity);
router.get('/:id', protect, getStudentById);
router.post('/promote', protect, authorize('super-admin', 'school-admin', 'principal', 'admin'), promoteStudents);
router.post('/rollback-promotion', protect, authorize('super-admin', 'school-admin', 'principal', 'admin'), rollbackPromotion);
router.post('/bulk-import', protect, authorize('super-admin', 'school-admin', 'principal'), bulkImportStudents);
router.post('/bulk-delete', protect, authorize('super-admin', 'school-admin'), bulkDeleteStudents);
router.post('/bulk-promote', protect, authorize('super-admin', 'school-admin', 'principal'), bulkPromoteStudents);
router.post('/', protect, authorize('super-admin', 'school-admin', 'principal'), createStudent);
router.put('/:id', protect, authorize('super-admin', 'school-admin', 'principal'), updateStudent);
router.patch('/:id/deactivate', protect, authorize('super-admin', 'school-admin', 'principal'), deactivateStudent);
router.patch('/:id/reset-password', protect, authorize('super-admin', 'school-admin', 'principal'), resetStudentPassword);
router.delete('/:id', protect, authorize('super-admin', 'school-admin'), deleteStudent);

export default router;
