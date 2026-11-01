// 2. External packages
import express from 'express';

// 5. Middleware
import { protect } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';

// 8. Controllers
import {
  bulkIssueCertificates,
  createCustomTemplate,
  deleteCustomTemplate,
  getCustomTemplates,
  getDefaultTemplate,
  getIssuedCertificateById,
  getIssuedCertificates,
  issueCertificate,
  revokeCertificate,
  setDefaultTemplate,
  updateCustomTemplate,
  verifyCertificate,
} from '../controllers/documentController.js';

const router = express.Router();

const DOCUMENT_ADMIN_ROLES = ['super-admin', 'school-admin', 'principal', 'director'];

// Certificate Routes
router.post('/certificates/issue', protect, authorize(...DOCUMENT_ADMIN_ROLES), issueCertificate);
router.post(
  '/certificates/bulk-issue',
  protect,
  authorize(...DOCUMENT_ADMIN_ROLES),
  bulkIssueCertificates
);
router.get('/certificates', protect, getIssuedCertificates);
router.get('/certificates/:id', protect, getIssuedCertificateById);
router.patch(
  '/certificates/:id/revoke',
  protect,
  authorize(...DOCUMENT_ADMIN_ROLES),
  revokeCertificate
);

// Public Verification Route
router.get('/verify/:token', verifyCertificate);

// Custom Template Routes
router.get('/templates/custom', protect, getCustomTemplates);
router.post('/templates/custom', protect, authorize(...DOCUMENT_ADMIN_ROLES), createCustomTemplate);
router.put(
  '/templates/custom/:id',
  protect,
  authorize(...DOCUMENT_ADMIN_ROLES),
  updateCustomTemplate
);
router.delete(
  '/templates/custom/:id',
  protect,
  authorize(...DOCUMENT_ADMIN_ROLES),
  deleteCustomTemplate
);

// Institution Default / Finalized Template Routes
router.get('/templates/default/:category', protect, getDefaultTemplate);
router.post('/templates/default', protect, authorize(...DOCUMENT_ADMIN_ROLES), setDefaultTemplate);

export default router;
