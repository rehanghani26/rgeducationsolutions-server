// 3. Configuration
import { checkFallback } from "../config/db.js";
import { getDefaultRolePermissions } from "../config/defaultRolePermissions.js";

// 4. Models
import RolePermission from "../models/RolePermission.js";

// 6. Services
import { FallbackDb } from "../services/dbFallback.js";

// 7. Utilities
import { sendForbidden, sendUnauthorized } from "../utils/responseUtil.js";

/**
 * @file rbac.js
 * @description Centralized Role-Based Access Control (RBAC) middlewares.
 * Authorization is derived exclusively from the user's institutional role.
 */

/**
 * Helper to normalize role strings
 */
export const normalizeRole = (r) => {
  if (!r) return "";
  const clean = String(r).trim().toLowerCase().replace(/_/g, "-");
  if (clean === "superadmin") return "super-admin";
  if (clean === "admin") return "school-admin";
  return clean;
};

/**
 * Middleware to authorize requests based on user roles.
 *
 * @param {...string} roles - Allowed role names (e.g. 'admin', 'teacher', 'student').
 * @returns {import('express').RequestHandler}
 */
export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return sendUnauthorized(res, "Authentication required");
    }

    const userRole = normalizeRole(req.user.role);
    const allowedRoles = roles.flatMap((r) => {
      const lower = normalizeRole(r);
      if (lower === "super-admin") {
        return ["super-admin", "superadmin"];
      }
      if (lower === "school-admin") {
        return ["school-admin", "admin"];
      }
      return [lower];
    });

    if (!allowedRoles.includes(userRole)) {
      return sendForbidden(
        res,
        `Role '${req.user.role}' is not authorized to access this resource`
      );
    }

    next();
  };
};

/**
 * Helper to get active role permissions for a tenant and role
 */
export const getActiveRoleConfig = async (schoolId, role) => {
  const normRole = normalizeRole(role);
  if (normRole === "super-admin") {
    return { modules: ["*"], actions: { "*": ["*"] }, viewScope: "school_wide" };
  }

  try {
    let custom = null;
    if (checkFallback()) {
      const all = FallbackDb.find("rolePermissions") || [];
      custom = all.find(
        (r) => r.schoolId === schoolId && normalizeRole(r.role) === normRole
      );
    } else if (schoolId) {
      custom = await RolePermission.findOne({
        schoolId,
        role: normRole,
      }).lean();
    }

    if (custom && custom.modules && custom.modules.length > 0) {
      return custom;
    }
  } catch (err) {
    console.error("Error retrieving active role config:", err.message);
  }

  return getDefaultRolePermissions(normRole);
};

/**
 * Middleware to restrict endpoints based on role capabilities/modules.
 * Replaces per-user permission checks with dynamic role capability checks.
 *
 * @param {...string} modules - Required module names (e.g. 'attendance', 'reports').
 * @returns {import('express').RequestHandler}
 */
export const requirePermission = (...modules) => {
  return async (req, res, next) => {
    if (!req.user) {
      return sendUnauthorized(res, "Authentication required");
    }

    const userRole = normalizeRole(req.user.role);
    if (userRole === "super-admin") {
      return next();
    }

    const schoolId = req.schoolId || req.user.schoolId;
    const roleConfig = await getActiveRoleConfig(schoolId, userRole);
    const allowedModules = roleConfig.modules || [];

    if (allowedModules.includes("*")) {
      return next();
    }

    const hasAccess = modules.some(
      (mod) => allowedModules.includes(mod) || allowedModules.includes("*")
    );

    if (!hasAccess) {
      return sendForbidden(
        res,
        `Your role ('${req.user.role}') is not permitted to access this module`
      );
    }

    next();
  };
};

/**
 * Middleware to restrict endpoints based on module AND action.
 *
 * @param {string} moduleName - Target module (e.g. 'leave', 'budget')
 * @param {string} action - Required action (e.g. 'create', 'approve', 'revise')
 * @returns {import('express').RequestHandler}
 */
export const requireCapability = (moduleName, action = "read") => {
  return async (req, res, next) => {
    if (!req.user) {
      return sendUnauthorized(res, "Authentication required");
    }

    const userRole = normalizeRole(req.user.role);
    if (userRole === "super-admin") {
      return next();
    }

    const schoolId = req.schoolId || req.user.schoolId;
    const roleConfig = await getActiveRoleConfig(schoolId, userRole);
    const allowedModules = roleConfig.modules || [];

    if (
      !allowedModules.includes("*") &&
      !allowedModules.includes(moduleName)
    ) {
      return sendForbidden(
        res,
        `Access to '${moduleName}' is not enabled for your role ('${req.user.role}')`
      );
    }

    // Check action if actions map is defined
    if (roleConfig.actions && typeof roleConfig.actions === "object") {
      const allowedActions =
        roleConfig.actions[moduleName] ||
        roleConfig.actions["*"] ||
        (roleConfig.actions instanceof Map
          ? roleConfig.actions.get(moduleName) || roleConfig.actions.get("*")
          : null);

      if (
        allowedActions &&
        !allowedActions.includes("*") &&
        !allowedActions.includes(action)
      ) {
        return sendForbidden(
          res,
          `Action '${action}' on '${moduleName}' is not permitted for role '${req.user.role}'`
        );
      }
    }

    next();
  };
};
