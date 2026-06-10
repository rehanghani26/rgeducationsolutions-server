import express from 'express';
import multer from 'multer';
import {
  getClasses, getSections, getSubjects,
  getBooks, createBook, getLibraryIssues, issueBook,
  getTransport, getNotifications, getSettings, updateSettings, uploadProfileImage,
  seedDummies
} from '../controllers/erpController.js';
import { protect } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Please upload a valid image file'));
    }
    cb(null, true);
  }
});

// Academic Routes
router.get('/classes', protect, getClasses);
router.get('/sections', protect, getSections);
router.get('/subjects', protect, getSubjects);
router.get('/seed-dummies', protect, seedDummies);

// Library Routes
router.get('/library/books', protect, getBooks);
router.post('/library/books', protect, authorize('super-admin', 'school-admin', 'librarian'), createBook);
router.get('/library/issues', protect, getLibraryIssues);
router.post('/library/issue', protect, authorize('super-admin', 'school-admin', 'librarian'), issueBook);

// Transport Routes
router.get('/transport', protect, getTransport);

// Notification Routes
router.get('/notifications', protect, getNotifications);

// System settings Routes
router.get('/settings', protect, getSettings);
router.put('/settings', protect, authorize('super-admin', 'school-admin'), updateSettings);
router.post(
  '/uploads/profile-image',
  protect,
  authorize('super-admin', 'school-admin'),
  (req, res, next) => {
    upload.single('image')(req, res, (err) => {
      if (!err) return next();

      const message = err.code === 'LIMIT_FILE_SIZE'
        ? 'File size must be less than 5MB'
        : err.message;

      return res.status(400).json({ success: false, message });
    });
  },
  uploadProfileImage
);

export default router;
