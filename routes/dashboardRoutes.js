// 2. External packages
import express from "express";

// 5. Middleware
import { protect } from "../middleware/auth.js";
import { authorize } from "../middleware/rbac.js";

// 8. Controllers
import {
  getCampusOverview,
  getCharts,
  getStats,
  getStudentOverview,
  getStudentsAnalytics,
} from "../controllers/dashboardController.js";

const router = express.Router();
const campusAccess = authorize("super-admin", "school-admin", "principal", "director");

router.get("/student-overview", protect, authorize("student"), getStudentOverview);
router.get("/campus-overview", protect, campusAccess, getCampusOverview);
router.get("/stats", protect, getStats);
router.get("/charts", protect, getCharts);
router.get("/students-analytics", protect, campusAccess, getStudentsAnalytics);

export default router;
