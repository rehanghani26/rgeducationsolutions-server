// server/routes/vendorRoutes.js
import express from 'express';
import { protect } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';
import {
  getVendors,
  getVendorById,
  createVendor,
  updateVendor,
  deleteVendor,
  getVendorBills,
  recordVendorPayment,
} from '../controllers/vendorController.js';

const router = express.Router();
const readVendors = authorize('super-admin', 'school-admin', 'accountant', 'principal', 'librarian', 'hod', 'director');

router.get('/', protect, readVendors, getVendors);
router.get('/:id', protect, readVendors, getVendorById);
router.get('/:id/bills', protect, readVendors, getVendorBills);

router.post(
  '/',
  protect,
  authorize('super-admin', 'school-admin', 'accountant'),
  createVendor
);

router.put(
  '/:id',
  protect,
  authorize('super-admin', 'school-admin', 'accountant'),
  updateVendor
);

router.delete(
  '/:id',
  protect,
  authorize('super-admin', 'school-admin'),
  deleteVendor
);

router.post(
  '/:id/pay',
  protect,
  authorize('super-admin', 'school-admin', 'accountant'),
  recordVendorPayment
);

export default router;

