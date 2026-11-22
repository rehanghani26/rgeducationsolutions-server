// 2. External packages
import express from "express";
import multer from "multer";

// 5. Middleware
import { protect } from "../middleware/auth.js";
import { authorize } from "../middleware/rbac.js";
import { sendBadRequest } from "../utils/responseUtil.js";

// 8. Controllers
import {
  getAllLeaves,
  getMyLeaves,
  requestLeave,
  reviewLeave,
} from "../controllers/leaveController.js";
import {
  bulkDeleteTeachers,
  bulkImportTeachers,
  createTeacher,
  deactivateTeacher,
  deleteTeacher,
  exportTeachers,
  getTeacherActivity,
  getTeacherById,
  getTeacherCredentials,
  getTeacherFile,
  getTeachers,
  resetTeacherPassword,
  updateTeacher,
} from "../controllers/teacherController.js";

const router = express.Router();
const manageTeachers = authorize("super-admin", "school-admin", "principal");
const uploadProfileFiles = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024, files: 2, fields: 1, fieldSize: 64 * 1024 },
}).fields([{ name: 'photo', maxCount: 1 }, { name: 'aadhaar', maxCount: 1 }]);

function readTeacherProfile(req, res, next) {
  if (!req.is('multipart/form-data')) return next();
  uploadProfileFiles(req, res, (error) => {
    if (error) {
      return sendBadRequest(res, error.code === 'LIMIT_FILE_SIZE' ? 'Each teacher file must be 1 MB or smaller.' : 'Could not read the teacher files.');
    }
    try {
      req.body = JSON.parse(req.body.profile || '');
    } catch {
      return sendBadRequest(res, 'Provide the teacher profile with the files.');
    }
    return next();
  });
}

/**
 * @route   GET /api/v1/teachers/export/csv
 * @desc    Export teachers list as CSV
 * @access  Private (Admin / Principal)
 */
router.get(
  "/export/csv",
  protect,
  authorize("super-admin", "school-admin", "principal"),
  exportTeachers
);

/**
 * @route   POST /api/v1/teachers/bulk-import
 * @desc    Bulk import faculty staff records
 * @access  Private (Admin / Principal)
 */
router.post(
  "/bulk-import",
  protect,
  authorize("super-admin", "school-admin", "principal"),
  bulkImportTeachers
);

/**
 * @route   GET /api/v1/teachers
 * @desc    Get paginated teachers with filters
 * @access  Private
 */
router.get("/", protect, getTeachers);

// Leaves management (Registered above /:id parameter matching route to prevent route clashing)
router.get(
  "/leaves/all",
  protect,
  authorize("super-admin", "school-admin", "principal"),
  getAllLeaves
);
router.get(
  "/leaves/my",
  protect,
  authorize("teacher", "head-teacher", "hod", "coordinator"),
  getMyLeaves
);
router.post(
  "/leaves/request",
  protect,
  authorize("teacher", "head-teacher", "hod", "coordinator"),
  requestLeave
);
router.patch(
  "/:teacherId/leaves/:leaveId",
  protect,
  authorize("super-admin", "school-admin", "principal"),
  reviewLeave
);

router.get(
  "/:id/credentials",
  protect,
  authorize("super-admin"),
  getTeacherCredentials
);

router.get("/:id/activity", protect, getTeacherActivity);
router.get("/:id/files/:kind", protect, getTeacherFile);
router.get("/:id", protect, getTeacherById);
router.post(
  "/bulk-delete",
  protect,
  authorize("super-admin", "school-admin"),
  bulkDeleteTeachers
);
router.post(
  "/",
  protect,
  manageTeachers,
  readTeacherProfile,
  createTeacher
);
router.put(
  "/:id",
  protect,
  manageTeachers,
  readTeacherProfile,
  updateTeacher
);
router.patch(
  "/:id/deactivate",
  protect,
  authorize("super-admin", "school-admin", "principal"),
  deactivateTeacher
);
router.patch(
  "/:id/reset-password",
  protect,
  authorize("super-admin", "school-admin", "principal"),
  resetTeacherPassword
);
router.delete(
  "/:id",
  protect,
  authorize("super-admin", "school-admin"),
  deleteTeacher
);

export default router;
