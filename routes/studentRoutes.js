// 2. External packages
import express from "express";
import multer from "multer";

// 5. Middleware
import { protect } from "../middleware/auth.js";
import { authorize } from "../middleware/rbac.js";

// 7. Utilities
import { sendBadRequest } from "../utils/responseUtil.js";

// 8. Controllers
import {
  bulkDeleteStudents,
  bulkImportStudents,
  bulkPromoteStudents,
  createStudent,
  deactivateStudent,
  deleteStudent,
  exportStudents,
  getPromotionStatus,
  getStudentActivity,
  getStudentById,
  getStudentCredentials,
  getStudentFileById,
  getStudents,
  promoteStudents,
  resetStudentPassword,
  rollbackPromotion,
  sendStudentEmailOtp,
  updateStudent,
  uploadStudentFile,
  verifyStudentEmailOtp,
} from "../controllers/studentController.js";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 }, // 1MB strictly
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
      "application/pdf",
    ];
    if (
      !allowedMimeTypes.includes(file.mimetype) &&
      !file.originalname.toLowerCase().endsWith(".pdf")
    ) {
      return cb(
        new Error(
          "Invalid file format. Only JPG, PNG, WEBP images and PDF documents are allowed."
        )
      );
    }
    cb(null, true);
  },
});

const handleStudentFileUpload = (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (!err) return next();

    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "File size must not exceed 1MB"
        : err.message;

    return sendBadRequest(res, message);
  });
};

router.get(
  "/export/csv",
  protect,
  authorize("super-admin", "school-admin", "principal"),
  exportStudents
);
router.get("/promotion-status", protect, getPromotionStatus);
router.get("/", protect, getStudents);
router.get("/file/:fileId(*)", getStudentFileById);
router.get(
  "/:id/credentials",
  protect,
  authorize("super-admin"),
  getStudentCredentials
);
router.get("/:id/activity", protect, getStudentActivity);
router.get("/:id", protect, getStudentById);
router.post(
  "/promote",
  protect,
  authorize("super-admin", "school-admin", "principal", "admin"),
  promoteStudents
);
router.post(
  "/rollback-promotion",
  protect,
  authorize("super-admin", "school-admin", "principal", "admin"),
  rollbackPromotion
);
router.post(
  "/bulk-import",
  protect,
  authorize(
    "super-admin",
    "school-admin",
    "principal",
    "admin",
    "director"
  ),
  bulkImportStudents
);
router.post(
  "/bulk-delete",
  protect,
  authorize("super-admin", "school-admin", "admin", "director"),
  bulkDeleteStudents
);
router.post(
  "/bulk-promote",
  protect,
  authorize(
    "super-admin",
    "school-admin",
    "principal",
    "admin",
    "director"
  ),
  bulkPromoteStudents
);
router.post(
  "/upload-file",
  protect,
  authorize(
    "super-admin",
    "school-admin",
    "principal",
    "admin",
    "director"
  ),
  handleStudentFileUpload,
  uploadStudentFile
);
router.post("/send-email-otp", protect, sendStudentEmailOtp);
router.post("/verify-email-otp", protect, verifyStudentEmailOtp);
router.post(
  "/",
  protect,
  authorize(
    "super-admin",
    "school-admin",
    "principal",
    "admin",
    "director"
  ),
  createStudent
);
router.put(
  "/:id",
  protect,
  authorize(
    "super-admin",
    "school-admin",
    "principal",
    "admin",
    "director"
  ),
  updateStudent
);
router.patch(
  "/:id/deactivate",
  protect,
  authorize(
    "super-admin",
    "school-admin",
    "principal",
    "admin",
    "director"
  ),
  deactivateStudent
);
router.patch(
  "/:id/reset-password",
  protect,
  authorize(
    "super-admin",
    "school-admin",
    "principal",
    "admin",
    "director"
  ),
  resetStudentPassword
);
router.delete(
  "/:id",
  protect,
  authorize("super-admin", "school-admin", "admin", "director"),
  deleteStudent
);

export default router;
