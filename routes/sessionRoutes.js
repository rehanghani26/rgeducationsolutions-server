import express from 'express';
import {
  getAcademicSessions,
  createAcademicSession,
  activateAcademicSession,
  updateAcademicSession,
  deleteAcademicSession,
} from '../controllers/sessionController.js';
import { protect } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';

const router = express.Router();

router.get('/', protect, getAcademicSessions);
router.post('/', protect, authorize('super-admin', 'school-admin', 'principal', 'admin'), createAcademicSession);
router.patch('/:id/activate', protect, authorize('super-admin', 'school-admin', 'principal', 'admin'), activateAcademicSession);
router.put('/:id', protect, authorize('super-admin', 'school-admin', 'principal', 'admin'), updateAcademicSession);
router.delete('/:id', protect, authorize('super-admin', 'school-admin', 'principal', 'admin'), deleteAcademicSession);

export default router;
