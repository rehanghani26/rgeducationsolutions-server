// 2. External packages
import express from "express";

// 5. Middleware
import { protect } from "../middleware/auth.js";
import { authorize } from "../middleware/rbac.js";

// 8. Controllers
import {
  adjustStock,
  createInventoryItem,
  createVendor,
  getAlerts,
  getInventory,
  getInventoryActivity,
  getInventoryById,
  getVendors,
  updateInventoryItem,
} from "../controllers/inventoryController.js";

const router = express.Router();

router.get("/alerts", protect, getAlerts);
router.get("/vendors", protect, getVendors);
router.post(
  "/vendors",
  protect,
  authorize("super-admin", "school-admin"),
  createVendor
);
router.post(
  "/stock-adjust",
  protect,
  authorize("super-admin", "school-admin", "accountant"),
  adjustStock
);
router.get("/", protect, getInventory);
router.get("/:id/activity", protect, getInventoryActivity);
router.get("/:id", protect, getInventoryById);
router.post(
  "/",
  protect,
  authorize("super-admin", "school-admin", "accountant"),
  createInventoryItem
);
router.put(
  "/:id",
  protect,
  authorize("super-admin", "school-admin", "accountant"),
  updateInventoryItem
);

export default router;
