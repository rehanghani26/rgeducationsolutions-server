import express from 'express';
import multer from 'multer';
import {
  getClasses, createClass, getSections, createSection, getSubjects, createSubject,
  getBooks, createBook, getLibraryIssues, issueBook,
  getTransport, getNotifications, getSettings, updateSettings, uploadProfileImage,
  seedDummies, getNotices, createNotice, deleteNotice,
  getMyLeaves, getAllLeaves, requestLeave, reviewLeave,
  getCurriculums, createCurriculum, updateCurriculum, deleteCurriculum,
  addCurriculumUnit, addCurriculumMaterial
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
router.post('/classes', protect, authorize('super-admin', 'school-admin', 'principal'), createClass);
router.get('/sections', protect, getSections);
router.post('/sections', protect, authorize('super-admin', 'school-admin', 'principal'), createSection);
router.get('/subjects', protect, getSubjects);
router.post('/subjects', protect, authorize('super-admin', 'school-admin', 'principal'), createSubject);
router.get('/seed-dummies', protect, seedDummies);

// Academic Curriculum & Courses (Assignable by Super Admin, Admin & Class Teachers)
router.get('/curriculum', protect, getCurriculums);
router.post(
  '/curriculum',
  protect,
  authorize('super-admin', 'school-admin', 'principal', 'director', 'teacher', 'head-teacher', 'hod', 'coordinator'),
  createCurriculum
);
router.put(
  '/curriculum/:id',
  protect,
  authorize('super-admin', 'school-admin', 'principal', 'director', 'teacher', 'head-teacher', 'hod', 'coordinator'),
  updateCurriculum
);
router.delete(
  '/curriculum/:id',
  protect,
  authorize('super-admin', 'school-admin', 'principal', 'director'),
  deleteCurriculum
);
router.post(
  '/curriculum/:id/units',
  protect,
  authorize('super-admin', 'school-admin', 'principal', 'director', 'teacher', 'head-teacher', 'hod', 'coordinator'),
  addCurriculumUnit
);
router.post(
  '/curriculum/:id/materials',
  protect,
  authorize('super-admin', 'school-admin', 'principal', 'director', 'teacher', 'head-teacher', 'hod', 'coordinator'),
  addCurriculumMaterial
);

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

// Notice Board Routes
router.get('/notices', protect, getNotices);
router.post('/notices', protect, authorize('super-admin', 'school-admin', 'principal'), createNotice);
router.delete('/notices/:id', protect, authorize('super-admin', 'school-admin', 'principal'), deleteNotice);

// Leave Management Routes
router.get('/leaves/my', protect, getMyLeaves);
router.get('/leaves/all', protect, authorize('super-admin', 'school-admin', 'principal', 'teacher', 'head-teacher', 'hod'), getAllLeaves);
router.post('/leaves/request', protect, requestLeave);
router.patch('/leaves/:id/review', protect, authorize('super-admin', 'school-admin', 'principal', 'teacher', 'head-teacher'), reviewLeave);

export default router;
