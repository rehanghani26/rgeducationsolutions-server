// server/routes/inventoryRoutes.js
import express from 'express';
import { protect } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';
import {
  adjustStock,
  createInventoryItem,
  createIssuance,
  createPurchase,
  createVendor,
  deleteInventoryItem,
  getAlerts,
  getInventory,
  getInventoryActivity,
  getInventoryById,
  getInventorySummary,
  getIssuances,
  getPurchases,
  getTransactions,
  getVendors,
  updateInventoryItem,
} from '../controllers/inventoryController.js';

const router = express.Router();

// Summary, KPIs & Alerts
router.get('/summary', protect, getInventorySummary);
router.get('/alerts', protect, getAlerts);
router.get('/transactions', protect, getTransactions);

// Purchases (Inward Stock & Vendor Bills)
router.get('/purchases', protect, getPurchases);
router.post(
  '/purchases',
  protect,
  authorize('super-admin', 'school-admin', 'accountant'),
  createPurchase
);

// Issuances (Outward Stock & Class-Wise Requisition)
router.get('/issuances', protect, getIssuances);
router.post(
  '/issuances',
  protect,
  authorize('super-admin', 'school-admin', 'accountant'),
  createIssuance
);

// Stock Adjustments
router.post(
  '/stock-adjust',
  protect,
  authorize('super-admin', 'school-admin', 'accountant'),
  adjustStock
);

// Vendors (backward compatibility)
router.get('/vendors', protect, getVendors);
router.post(
  '/vendors',
  protect,
  authorize('super-admin', 'school-admin'),
  createVendor
);

// Inventory Items CRUD
router.get('/', protect, getInventory);
router.get('/:id/activity', protect, getInventoryActivity);
router.get('/:id', protect, getInventoryById);

router.post(
  '/',
  protect,
  authorize('super-admin', 'school-admin', 'accountant'),
  createInventoryItem
);

router.put(
  '/:id',
  protect,
  authorize('super-admin', 'school-admin', 'accountant'),
  updateInventoryItem
);

router.delete(
  '/:id',
  protect,
  authorize('super-admin', 'school-admin'),
  deleteInventoryItem
);

export default router;
