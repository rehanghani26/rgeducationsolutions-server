// 2. External packages
import express from "express";

// 5. Middleware
import { protect } from "../middleware/auth.js";
import { authorize } from "../middleware/rbac.js";

// 8. Controllers
import {
  cancelLeave,
  getActiveLeavesOnDate,
  getAllLeaves,
  getApplicantLeaveProfile,
  getMyLeaves,
  requestLeave,
  reviewLeave,
} from "../controllers/leaveController.js";

const router = express.Router();

// ─── Public within Authenticated Session ───
router.get("/my", protect, getMyLeaves);
router.post("/request", protect, requestLeave);
router.get("/applicant/:id", protect, getApplicantLeaveProfile);
router.delete("/:id", protect, cancelLeave);

// ─── Roster Active Leaves for Attendance Taking ───
router.get("/active-on-date", protect, getActiveLeavesOnDate);

// ─── Administrative & Review Endpoints ───
router.get(
  "/all",
  protect,
  authorize(
    "super-admin",
    "school-admin",
    "principal",
    "director",
    "teacher",
    "head-teacher",
    "hod",
    "coordinator"
  ),
  getAllLeaves
);

router.patch(
  "/:id/review",
  protect,
  authorize(
    "super-admin",
    "school-admin",
    "principal",
    "director",
    "teacher",
    "head-teacher"
  ),
  reviewLeave
);

export default router;
