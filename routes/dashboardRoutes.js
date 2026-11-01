// 2. External packages
import express from "express";

// 5. Middleware
import { protect } from "../middleware/auth.js";

// 8. Controllers
import {
  getCharts,
  getStats,
  getStudentsAnalytics,
} from "../controllers/dashboardController.js";

const router = express.Router();

router.get("/stats", protect, getStats);
router.get("/charts", protect, getCharts);
router.get("/students-analytics", protect, getStudentsAnalytics);

export default router;
