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
  createVendor,
  deleteInventoryItem,
  getAlerts,
  getInventory,
  getInventoryActivity,
  getInventoryById,
  getInventorySummary,
  getTransactions,
  getVendors,
  updateInventoryItem,
  uploadInventoryAttachments,
} from '../controllers/inventoryController.js';

const router = express.Router();

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
router.get('/summary', protect, getInventorySummary);
router.get('/alerts', protect, getAlerts);
router.get('/transactions', protect, getTransactions);


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
