// 2. External packages
import express from "express";

// 5. Middleware
import { protect } from "../middleware/auth.js";
import { authorize } from "../middleware/rbac.js";

// 8. Controllers
import {
  getLoginHistory,
  getLogs,
  getRecordActivity,
} from "../controllers/auditLogController.js";

const router = express.Router();

router.get(
  "/",
  protect,
  authorize("super-admin", "school-admin", "principal"),
  getLogs
);
router.get(
  "/login/:userId",
  protect,
  authorize("super-admin", "school-admin", "principal"),
  getLoginHistory
);
router.get("/:module/:recordId", protect, getRecordActivity);

export default router;
