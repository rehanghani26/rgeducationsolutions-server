// 3. Configuration
import { checkFallback } from '../config/db.js';
import {
  ALL_ACTION_BUTTONS,
  ALL_SYSTEM_MODULES,
  DEFAULT_ROLE_PERMISSIONS,
  getDefaultRolePermissions,
} from '../config/defaultRolePermissions.js';

// 4. Models
import RolePermission from '../models/RolePermission.js';

// 6. Services
import { FallbackDb } from '../services/dbFallback.js';

// 7. Utilities
import tenantContext from '../utils/tenantContext.js';
import { logActivity } from '../utils/activityLogger.js';
import {
  sendBadRequest,
  sendError,
  sendForbidden,
  sendNotFound,
  sendSuccess,
} from '../utils/responseUtil.js';

/**
 * @file roleAccessController.js
 * @description Controller for managing tenant-scoped role-based access control (RBAC).
 */

const ALL_ROLES_LIST = [
  'super-admin',
  'school-admin',
  'principal',
  'director',
  'teacher',
  'head-teacher',
  'hod',
  'coordinator',
  'accountant',
  'librarian',
  'peon',
  'student',
  'parent',
];

/**
 * Normalizes role string to standard lowercase kebab-case.
 */
const normalizeRole = (r) => {
  if (!r) return '';
  const clean = String(r).trim().toLowerCase().replace(/_/g, '-');
  if (clean === 'superadmin') return 'super-admin';
  if (clean === 'admin') return 'school-admin';
  return clean;
};

/**
 * Get resolved role permissions for all roles in current school tenant.
 * Merges factory defaults with custom database overrides.
 */
export const getRolePermissions = async (req, res) => {
  try {
    const schoolId =
      tenantContext.getSchoolId() || req.user?.schoolId || req.schoolId;

    if (!schoolId) {
      return sendBadRequest(res, 'Active school tenant context is required');
    }

    let customRecords = [];
    if (checkFallback()) {
      const all = FallbackDb.find('rolePermissions') || [];
      customRecords = all.filter((r) => r.schoolId === schoolId);
    } else {
      customRecords = await RolePermission.find({ schoolId }).lean();
    }

    const customMap = {};
    (customRecords || []).forEach((rec) => {
      if (rec.role) {
        customMap[rec.role.toLowerCase()] = rec;
      }
    });

    const rolesMatrix = ALL_ROLES_LIST.map((roleKey) => {
      const def = DEFAULT_ROLE_PERMISSIONS[roleKey] || getDefaultRolePermissions(roleKey);
      const custom = customMap[roleKey];

      if (custom) {
        return {
          ...def,
          ...custom,
          role: roleKey,
          isCustomized: true,
        };
      }

      return {
        ...def,
        role: roleKey,
        isCustomized: false,
      };
    });

    return sendSuccess(res, 'Role permissions retrieved successfully', {
      roles: rolesMatrix,
      allModules: ALL_SYSTEM_MODULES,
      allButtons: ALL_ACTION_BUTTONS,
    });
  } catch (error) {
    console.error('getRolePermissions error:', error);
    return sendError(res, 'Failed to fetch role permissions', 500, error);
  }
};

/**
 * Get active permissions for the currently authenticated user's role.
 */
export const getMyRolePermissions = async (req, res) => {
  try {
    const schoolId =
      tenantContext.getSchoolId() || req.user?.schoolId || req.schoolId;
    const userRole = normalizeRole(req.user?.role || 'teacher');

    let permissionRecord = null;
    if (checkFallback()) {
      const all = FallbackDb.find('rolePermissions') || [];
      permissionRecord = all.find(
        (r) => r.schoolId === schoolId && normalizeRole(r.role) === userRole
      );
    } else {
      permissionRecord = await RolePermission.findOne({
        schoolId,
        role: userRole,
      }).lean();
    }

    const resolved = permissionRecord || getDefaultRolePermissions(userRole);

    return sendSuccess(res, undefined, {
      role: userRole,
      permissions: resolved,
    });
  } catch (error) {
    console.error('getMyRolePermissions error:', error);
    return sendError(res, 'Failed to fetch current user permissions', 500, error);
  }
};

/**
 * Update permissions for a specific institutional role.
 */
export const updateRolePermissions = async (req, res) => {
  const { role } = req.params;
  const targetRole = normalizeRole(role);

  if (!targetRole || !ALL_ROLES_LIST.includes(targetRole)) {
    return sendBadRequest(res, `Invalid role '${role}'`);
  }

  // Immutable Master Governance: Super Admin cannot be restricted
  if (targetRole === 'super-admin') {
    return sendForbidden(
      res,
      'Super Admin (Director) has permanent wildcard access. Permissions for Super Admin cannot be restricted or modified.'
    );
  }

  const {
    modules = [],
    actions = {},
    buttons = [],
    viewScope = 'self_only',
    workflowSettings = {},
  } = req.body;

  try {
    const schoolId =
      tenantContext.getSchoolId() || req.user?.schoolId || req.schoolId;

    if (!schoolId) {
      return sendBadRequest(res, 'Active school tenant context is required');
    }

    const payload = {
      schoolId,
      role: targetRole,
      modules: Array.isArray(modules) ? modules : [],
      actions: actions || {},
      buttons: Array.isArray(buttons) ? buttons : [],
      viewScope,
      workflowSettings: {
        canApplyLeaveSelf: workflowSettings.canApplyLeaveSelf ?? true,
        canApplyLeaveOnBehalf: workflowSettings.canApplyLeaveOnBehalf ?? false,
        canApproveLeaves: workflowSettings.canApproveLeaves ?? false,
        leaveApprovalScope: workflowSettings.leaveApprovalScope || 'none',
        canViewBudget: workflowSettings.canViewBudget ?? false,
        canReviseBudget: workflowSettings.canReviseBudget ?? false,
        canManageUsers: workflowSettings.canManageUsers ?? false,
      },
      isCustomized: true,
    };

    let updated = null;
    if (checkFallback()) {
      const all = FallbackDb.find('rolePermissions') || [];
      const existing = all.find(
        (r) => r.schoolId === schoolId && normalizeRole(r.role) === targetRole
      );

      if (existing) {
        updated = FallbackDb.update('rolePermissions', existing.id, payload);
      } else {
        updated = FallbackDb.create('rolePermissions', payload);
      }
    } else {
      updated = await RolePermission.findOneAndUpdate(
        { schoolId, role: targetRole },
        { $set: payload },
        { new: true, upsert: true, runValidators: true }
      );
    }

    await logActivity({
      schoolId,
      userId: req.user?.id || req.user?._id,
      action: 'UPDATE_ROLE_PERMISSIONS',
      module: 'setup',
      details: `Updated permissions for role: ${targetRole}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, `Permissions for role '${targetRole}' saved successfully`, {
      rolePermission: updated,
    });
  } catch (error) {
    console.error('updateRolePermissions error:', error);
    return sendError(res, 'Failed to update role permissions', 500, error);
  }
};

/**
 * Reset role permissions to institutional defaults.
 */
export const resetRolePermissions = async (req, res) => {
  const { role } = req.params;
  const targetRole = role ? normalizeRole(role) : null;

  try {
    const schoolId =
      tenantContext.getSchoolId() || req.user?.schoolId || req.schoolId;

    if (!schoolId) {
      return sendBadRequest(res, 'Active school tenant context is required');
    }

    if (checkFallback()) {
      const all = FallbackDb.find('rolePermissions') || [];
      const toDelete = all.filter(
        (r) =>
          r.schoolId === schoolId &&
          (!targetRole || normalizeRole(r.role) === targetRole)
      );
      toDelete.forEach((td) => FallbackDb.delete('rolePermissions', td.id));
    } else {
      const filter = { schoolId };
      if (targetRole) {
        filter.role = targetRole;
      }
      await RolePermission.deleteMany(filter);
    }

    await logActivity({
      schoolId,
      userId: req.user?.id || req.user?._id,
      action: 'RESET_ROLE_PERMISSIONS',
      module: 'setup',
      details: targetRole
        ? `Reset permissions for role: ${targetRole} to default`
        : 'Reset all role permissions to factory defaults',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendSuccess(
      res,
      targetRole
        ? `Role '${targetRole}' reset to factory defaults`
        : 'All role permissions reset to factory defaults'
    );
  } catch (error) {
    console.error('resetRolePermissions error:', error);
    return sendError(res, 'Failed to reset role permissions', 500, error);
  }
};
