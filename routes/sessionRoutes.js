// 2. External packages
import express from "express";

// 5. Middleware
import { protect } from "../middleware/auth.js";
import { authorize } from "../middleware/rbac.js";

// 8. Controllers
import {
  activateAcademicSession,
  createAcademicSession,
  deleteAcademicSession,
  getAcademicSessions,
  getActiveSession,
  updateAcademicSession,
} from "../controllers/sessionController.js";

const router = express.Router();

router.get("/", protect, getAcademicSessions);
router.get("/active", protect, getActiveSession);
router.post(
  "/",
  protect,
  authorize("super-admin", "school-admin", "principal", "admin"),
  createAcademicSession
);
router.patch(
  "/:id/activate",
  protect,
  authorize("super-admin", "school-admin", "principal", "admin"),
  activateAcademicSession
);
router.put(
  "/:id",
  protect,
  authorize("super-admin", "school-admin", "principal", "admin"),
  updateAcademicSession
);
router.delete(
  "/:id",
  protect,
  authorize("super-admin", "school-admin", "principal", "admin"),
  deleteAcademicSession
);

export default router;
