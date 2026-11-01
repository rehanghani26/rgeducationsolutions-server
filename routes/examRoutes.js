// 2. External packages
import express from "express";

// 5. Middleware
import { protect } from "../middleware/auth.js";
import { authorize } from "../middleware/rbac.js";

// 8. Controllers
import {
  createExam,
  deleteExam,
  getExamActivity,
  getExamById,
  getExams,
  updateExam,
} from "../controllers/examController.js";

const router = express.Router();

router.get("/", protect, getExams);
router.get("/:id/activity", protect, getExamActivity);
router.get("/:id", protect, getExamById);
router.post(
  "/",
  protect,
  authorize(
    "super-admin",
    "school-admin",
    "admin",
    "principal",
    "teacher",
    "head-teacher",
    "director",
    "hod",
    "coordinator"
  ),
  createExam
);
router.put(
  "/:id",
  protect,
  authorize(
    "super-admin",
    "school-admin",
    "admin",
    "principal",
    "teacher",
    "head-teacher",
    "director",
    "hod",
    "coordinator"
  ),
  updateExam
);
router.delete(
  "/:id",
  protect,
  authorize("super-admin", "school-admin", "admin", "principal"),
  deleteExam
);

export default router;
