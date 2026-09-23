import express from 'express';
import { protect } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';
import {
  issueCertificate,
  bulkIssueCertificates,
  getIssuedCertificates,
  getIssuedCertificateById,
  revokeCertificate,
  verifyCertificate,
  getCustomTemplates,
  createCustomTemplate,
  updateCustomTemplate,
  deleteCustomTemplate,
  getDefaultTemplate,
  setDefaultTemplate,
} from '../controllers/documentController.js';

const router = express.Router();

// ── Admin roles allowed to issue/revoke/manage documents ──────────────────────
const DOCUMENT_ADMIN_ROLES = ['super-admin', 'school-admin', 'principal', 'director'];

// ── Certificate Routes ────────────────────────────────────────────────────────

/**
 * Issue an official certificate for a single recipient.
 * Creates an IssuedCertificate record. The actual HTML/PDF is NOT stored.
 */
router.post(
  '/certificates/issue',
  protect,
  authorize(...DOCUMENT_ADMIN_ROLES),
  issueCertificate
);

/**
 * Bulk issue certificates for multiple recipients in a single request.
 * Creates all records efficiently — NOT one API call per recipient.
 */
router.post(
  '/certificates/bulk-issue',
  protect,
  authorize(...DOCUMENT_ADMIN_ROLES),
  bulkIssueCertificates
);

/**
 * List all issued certificate records.
 * Admins see all; students see only their own.
 */
router.get('/certificates', protect, getIssuedCertificates);

/**
 * Get a single issued certificate record by MongoDB ID.
 * Used for re-rendering a previously issued certificate.
 */
router.get('/certificates/:id', protect, getIssuedCertificateById);

/**
 * Revoke an issued certificate.
 * Status is set to REVOKED — the record is NEVER deleted for audit purposes.
 */
router.patch(
  '/certificates/:id/revoke',
  protect,
  authorize(...DOCUMENT_ADMIN_ROLES),
  revokeCertificate
);

// ── Public Verification Route ─────────────────────────────────────────────────

/**
 * PUBLIC endpoint — no authentication required.
 * Verifies a certificate using its QR code token.
 * Returns only safe, non-sensitive information (no phone, address, internal IDs).
 */
router.get('/verify/:token', verifyCertificate);

// ── Custom Template Routes ────────────────────────────────────────────────────

/**
 * List all active custom document templates.
 * Default templates live in the frontend codebase and are never stored here.
 */
router.get('/templates/custom', protect, getCustomTemplates);

/**
 * Create a new custom template by cloning a built-in template.
 * The original built-in template is never modified.
 */
router.post(
  '/templates/custom',
  protect,
  authorize(...DOCUMENT_ADMIN_ROLES),
  createCustomTemplate
);

/** Update a custom template's visual configuration. */
router.put(
  '/templates/custom/:id',
  protect,
  authorize(...DOCUMENT_ADMIN_ROLES),
  updateCustomTemplate
);

/** Soft-delete (deactivate) a custom template. */
router.delete(
  '/templates/custom/:id',
  protect,
  authorize(...DOCUMENT_ADMIN_ROLES),
  deleteCustomTemplate
);

// ── Institution Default / Finalized Template Routes ──────────────────────────

/**
 * Get the active institutional default / finalized template for a category (e.g. 'student-id-card').
 */
router.get('/templates/default/:category', protect, getDefaultTemplate);

/**
 * Finalize and set the institutional default template for a category.
 */
router.post(
  '/templates/default',
  protect,
  authorize(...DOCUMENT_ADMIN_ROLES),
  setDefaultTemplate
);

export default router;
