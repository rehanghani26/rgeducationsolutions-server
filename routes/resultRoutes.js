// 2. External packages
import express from "express";

// 5. Middleware
import { protect } from "../middleware/auth.js";
import { authorize } from "../middleware/rbac.js";

// 8. Controllers
import {
  bulkUpsertResults,
  deleteResult,
  getClassResults,
  getExamStats,
  getResults,
  getStudentExamResult,
  getStudentResults,
  publishResults,
  updateResult,
} from "../controllers/resultController.js";

const router = express.Router();

const ADMIN_ROLES = ["super-admin", "school-admin", "principal", "head-teacher"];
const TEACHER_ROLES = [...ADMIN_ROLES, "teacher"];

// ─── View Results ──────────────────────────────────────────────────────────────
router.get("/", protect, authorize(...TEACHER_ROLES), getResults);
router.get("/student/:studentId", protect, getStudentResults);
router.get(
  "/exam/:examId/student/:studentId",
  protect,
  getStudentExamResult
);
router.get(
  "/exam/:examId/class/:classId",
  protect,
  authorize(...TEACHER_ROLES),
  getClassResults
);
router.get(
  "/stats/:examId",
  protect,
  authorize(...TEACHER_ROLES),
  getExamStats
);

// ─── Enter / Edit Results ──────────────────────────────────────────────────────
router.post(
  "/bulk",
  protect,
  authorize(...TEACHER_ROLES),
  bulkUpsertResults
);
router.put("/:id", protect, authorize(...TEACHER_ROLES), updateResult);

// ─── Publish / Delete ──────────────────────────────────────────────────────────
router.put(
  "/exam/:examId/class/:classId/publish",
  protect,
  authorize(...ADMIN_ROLES),
  publishResults
);
router.delete("/:id", protect, authorize(...ADMIN_ROLES), deleteResult);

export default router;
