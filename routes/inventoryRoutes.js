import express from 'express';
import {
  getInventory,
  getInventoryById,
  getInventoryActivity,
  createInventoryItem,
  updateInventoryItem,
  adjustStock,
  getAlerts,
  getVendors,
  createVendor,
} from '../controllers/inventoryController.js';
import { protect } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';

const router = express.Router();

router.get('/alerts', protect, getAlerts);
router.get('/vendors', protect, getVendors);
router.post('/vendors', protect, authorize('super-admin', 'school-admin'), createVendor);
router.post('/stock-adjust', protect, authorize('super-admin', 'school-admin', 'accountant'), adjustStock);
router.get('/', protect, getInventory);
router.get('/:id/activity', protect, getInventoryActivity);
router.get('/:id', protect, getInventoryById);
router.post('/', protect, authorize('super-admin', 'school-admin', 'accountant'), createInventoryItem);
router.put('/:id', protect, authorize('super-admin', 'school-admin', 'accountant'), updateInventoryItem);

export default router;
