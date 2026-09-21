import express from 'express';
import multer from 'multer';
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
  uploadStudentFile,
  getStudentFileById,
} from '../controllers/studentController.js';
import { protect } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 }, // 1MB strictly
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'application/pdf',
    ];
    if (
      !allowedMimeTypes.includes(file.mimetype) &&
      !file.originalname.toLowerCase().endsWith('.pdf')
    ) {
      return cb(
        new Error(
          'Invalid file format. Only JPG, PNG, WEBP images and PDF documents are allowed.'
        )
      );
    }
    cb(null, true);
  },
});

const handleStudentFileUpload = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();

    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'File size must not exceed 1MB'
        : err.message;

    return res.status(400).json({ success: false, message });
  });
};

router.get('/export/csv', protect, authorize('super-admin', 'school-admin', 'principal'), exportStudents);
router.get('/promotion-status', protect, getPromotionStatus);
router.get('/', protect, getStudents);
router.get('/file/:fileId(*)', getStudentFileById);
router.get('/:id/credentials', protect, authorize('super-admin'), getStudentCredentials);
router.get('/:id/activity', protect, getStudentActivity);
router.get('/:id', protect, getStudentById);
router.post('/promote', protect, authorize('super-admin', 'school-admin', 'principal', 'admin'), promoteStudents);
router.post('/rollback-promotion', protect, authorize('super-admin', 'school-admin', 'principal', 'admin'), rollbackPromotion);
router.post('/bulk-import', protect, authorize('super-admin', 'school-admin', 'principal'), bulkImportStudents);
router.post('/bulk-delete', protect, authorize('super-admin', 'school-admin'), bulkDeleteStudents);
router.post('/bulk-promote', protect, authorize('super-admin', 'school-admin', 'principal'), bulkPromoteStudents);
router.post('/upload-file', protect, authorize('super-admin', 'school-admin', 'principal', 'admin'), handleStudentFileUpload, uploadStudentFile);
router.post('/', protect, authorize('super-admin', 'school-admin', 'principal'), createStudent);
router.put('/:id', protect, authorize('super-admin', 'school-admin', 'principal'), updateStudent);
router.patch('/:id/deactivate', protect, authorize('super-admin', 'school-admin', 'principal'), deactivateStudent);
router.patch('/:id/reset-password', protect, authorize('super-admin', 'school-admin', 'principal'), resetStudentPassword);
router.delete('/:id', protect, authorize('super-admin', 'school-admin'), deleteStudent);

export default router;
