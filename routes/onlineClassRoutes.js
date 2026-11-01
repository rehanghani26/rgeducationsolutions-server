// 2. External packages
import express from "express";

// 5. Middleware
import { protect } from "../middleware/auth.js";
import { authorize } from "../middleware/rbac.js";

// 8. Controllers
import {
  createOnlineClass,
  deleteOnlineClass,
  getOnlineClassActivity,
  getOnlineClassById,
  getOnlineClasses,
  joinOnlineClass,
  updateOnlineClass,
} from "../controllers/onlineClassController.js";

const router = express.Router();

// ─── Read (all authenticated users) ─────────────────────────────────────────
router.get("/", protect, getOnlineClasses);
router.get("/:id/activity", protect, getOnlineClassActivity);
router.get("/:id", protect, getOnlineClassById);

// ─── Write (admin + teaching roles) ─────────────────────────────────────────
router.post(
  "/",
  protect,
  authorize(
    "super-admin",
    "school-admin",
    "principal",
    "teacher",
    "head-teacher",
    "hod",
    "coordinator"
  ),
  createOnlineClass
);
router.put(
  "/:id",
  protect,
  authorize(
    "super-admin",
    "school-admin",
    "principal",
    "teacher",
    "head-teacher",
    "hod",
    "coordinator"
  ),
  updateOnlineClass
);
router.delete(
  "/:id",
  protect,
  authorize("super-admin", "school-admin", "principal"),
  deleteOnlineClass
);

// ─── Student join action ─────────────────────────────────────────────────────
router.post("/:id/join", protect, authorize("student"), joinOnlineClass);

export default router;
