// server/routes/inventoryRoutes.js
import express from 'express';
import multer from 'multer';
import path from 'path';
import { protect } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';
import {
  adjustStock,
  createBulkInventoryItems,
  createInventoryItem,
  createPurchase,
  deleteInventoryItem,
  getAlerts,
  getInventory,
  getInventoryActivity,
  getInventoryById,
  getInventorySummary,
  getPurchases,
  getTransactions,
  updateInventoryItem,
  uploadInventoryAttachments,
} from '../controllers/inventoryController.js';
import { createVendor, getVendors } from '../controllers/vendorController.js';

const router = express.Router();
const readInventory = authorize('super-admin', 'school-admin', 'accountant', 'principal', 'librarian', 'hod', 'director');

const inventoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB for PDF, PSD, Excel, docs & images
  fileFilter: (req, file, cb) => {
    const allowedExts = [
      '.pdf',
      '.psd',
      '.xlsx',
      '.xls',
      '.csv',
      '.png',
      '.jpg',
      '.jpeg',
      '.webp',
      '.doc',
      '.docx',
    ];
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!allowedExts.includes(ext)) {
      return cb(
        new Error(
          'Unsupported file type. Allowed: PDF, PSD, Excel (.xlsx/.xls/.csv), Word (.doc/.docx), and Images (PNG/JPG/WEBP).'
        )
      );
    }
    cb(null, true);
  },
});

// Summary, KPIs & Alerts
router.get('/summary', protect, readInventory, getInventorySummary);
router.get('/alerts', protect, readInventory, getAlerts);
router.get('/transactions', protect, readInventory, getTransactions);
router.get('/purchases', protect, readInventory, getPurchases);
router.post('/purchases', protect, authorize('super-admin', 'school-admin', 'accountant'), createPurchase);


// Stock Adjustments
router.post(
  '/stock-adjust',
  protect,
  authorize('super-admin', 'school-admin', 'accountant'),
  adjustStock
);

// Vendors (backward compatibility)
router.get('/vendors', protect, readInventory, getVendors);
router.post(
  '/vendors',
  protect,
  authorize('super-admin', 'school-admin'),
  createVendor
);

// Inventory Attachments & Bulk Creation
router.post(
  '/upload-attachment',
  protect,
  authorize('super-admin', 'school-admin', 'accountant'),
  inventoryUpload.array('files', 10),
  uploadInventoryAttachments
);

router.post(
  '/bulk',
  protect,
  authorize('super-admin', 'school-admin', 'accountant'),
  createBulkInventoryItems
);

// Inventory Items CRUD
router.get('/', protect, readInventory, getInventory);
router.get('/:id/activity', protect, readInventory, getInventoryActivity);
router.get('/:id', protect, readInventory, getInventoryById);

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
