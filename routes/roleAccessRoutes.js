// 2. External packages
import express from 'express';

// 5. Middleware
import { protect } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';

// 8. Controllers
import {
  getMyRolePermissions,
  getRolePermissions,
  resetRolePermissions,
  updateRolePermissions,
} from '../controllers/roleAccessController.js';

const router = express.Router();

// Require authentication for all role access endpoints
router.use(protect);

/**
 * @route   GET /api/v1/role-access/my
 * @desc    Fetch active permissions for currently logged in role
 * @access  Private (All authenticated users)
 */
router.get('/my', getMyRolePermissions);

/**
 * @route   GET /api/v1/role-access
 * @desc    Fetch role permission matrix for all system roles in tenant
 * @access  Private (All authenticated users in tenant)
 */
router.get('/', getRolePermissions);

/**
 * @route   PUT /api/v1/role-access/:role
 * @desc    Update permissions for a specific role
 * @access  Private (Super Admin, School Admin)
 */
router.put(
  '/:role',
  authorize('super-admin', 'school-admin', 'admin'),
  updateRolePermissions
);

/**
 * @route   POST /api/v1/role-access/reset/:role?
 * @desc    Reset a role (or all roles) to factory defaults
 * @access  Private (Super Admin, School Admin)
 */
router.post(
  ['/reset', '/reset/:role'],
  authorize('super-admin', 'school-admin', 'admin'),
  resetRolePermissions
);

export default router;
