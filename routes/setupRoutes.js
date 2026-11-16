// 2. External packages
import express from "express";

// 5. Middleware
import { protect } from "../middleware/auth.js";
import { authorize } from "../middleware/rbac.js";

// 8. Controllers
import {
  completeStep,
  dismissWizard,
  getSetupStatus,
  resetWizard,
} from "../controllers/setupController.js";
import {
  getMyRolePermissions,
  getRolePermissions,
  resetRolePermissions,
  updateRolePermissions,
} from "../controllers/roleAccessController.js";

/**
 * @file setupRoutes.js
 * @description API routes for the School ERP Setup Wizard & Role Access Control.
 */

const router = express.Router();

// ─── Setup Wizard Endpoints ───
// GET /api/v1/setup/status — View setup progress
router.get("/status", protect, getSetupStatus);

// POST /api/v1/setup/complete-step — Mark step complete
router.post(
  "/complete-step",
  protect,
  authorize("super-admin", "school-admin"),
  completeStep
);

// POST /api/v1/setup/dismiss — Dismiss wizard banner
router.post(
  "/dismiss",
  protect,
  authorize("super-admin", "school-admin"),
  dismissWizard
);

// POST /api/v1/setup/reset — Super admin only: reset wizard flags
router.post("/reset", protect, authorize("super-admin"), resetWizard);

// ─── Role & Access Governance Endpoints ───
router.get("/roles-access/my", protect, getMyRolePermissions);
router.get(
  "/roles-access",
  protect,
  authorize("super-admin", "school-admin", "admin", "principal"),
  getRolePermissions
);
router.put(
  "/roles-access/:role",
  protect,
  authorize("super-admin", "school-admin", "admin"),
  updateRolePermissions
);
router.post(
  ["/roles-access/reset", "/roles-access/reset/:role"],
  protect,
  authorize("super-admin", "school-admin", "admin"),
  resetRolePermissions
);

export default router;
