// 2. External packages
import express from "express";

// 5. Middleware
import { protect } from "../middleware/auth.js";
import { authorize } from "../middleware/rbac.js";

// 8. Controllers
import {
  createMasterPeriod,
  deleteClassTimetable,
  deleteMasterPeriod,
  getClassTimetable,
  getMasterPeriodById,
  getMasterPeriods,
  saveClassTimetable,
  updateMasterPeriod,
} from "../controllers/masterPeriodController.js";

const router = express.Router();

const adminOnly = authorize("super-admin", "school-admin", "principal");

// Timetable endpoints (Must be before /:id)
router.get("/timetable", protect, getClassTimetable);
router.post("/timetable", protect, adminOnly, saveClassTimetable);
router.delete("/timetable/:id", protect, adminOnly, deleteClassTimetable);

router.get("/", protect, getMasterPeriods);
router.get("/:id", protect, getMasterPeriodById);
router.post("/", protect, adminOnly, createMasterPeriod);
router.put("/:id", protect, adminOnly, updateMasterPeriod);
router.delete("/:id", protect, adminOnly, deleteMasterPeriod);

export default router;
