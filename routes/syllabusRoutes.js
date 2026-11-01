// 2. External packages
import express from "express";

// 5. Middleware
import { protect } from "../middleware/auth.js";
import { authorize } from "../middleware/rbac.js";

// 8. Controllers
import {
  getAllSyllabus,
  getSyllabusByClass,
  resetClassSyllabus,
  upsertClassSyllabus,
} from "../controllers/syllabusController.js";

const router = express.Router();

const STAFF_ROLES = [
  "super-admin",
  "superadmin",
  "super_admin",
  "school-admin",
  "school_admin",
  "admin",
  "principal",
  "head-teacher",
  "teacher",
  "director",
  "hod",
  "coordinator",
];

// Any authenticated user can read syllabus
router.get("/", protect, getAllSyllabus);
router.get("/:classId", protect, getSyllabusByClass);

// Staff can configure/update class syllabus & reset to standard
router.put(
  "/:classId",
  protect,
  authorize(...STAFF_ROLES),
  upsertClassSyllabus
);
router.post(
  "/:classId/reset",
  protect,
  authorize(...STAFF_ROLES),
  resetClassSyllabus
);

export default router;
