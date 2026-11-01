// 7. Utilities
import { sendForbidden, sendUnauthorized } from "../utils/responseUtil.js";

/**
 * @file rbac.js
 * @description Role-based and permission-based access control middlewares.
 */

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

    const userRole = String(req.user.role || "").toLowerCase();
    const allowedRoles = roles.flatMap((r) => {
      const lower = String(r).toLowerCase();
      if (lower === "super-admin" || lower === "superadmin") {
        return ["super-admin", "superadmin"];
      }
      if (lower === "school-admin" || lower === "admin") {
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
 * Middleware to restrict endpoints based on granular user permissions.
 *
 * @param {...string} permissions - Required permissions (e.g. 'attendance', 'reports').
 * @returns {import('express').RequestHandler}
 */
export const requirePermission = (...permissions) => {
  return (req, res, next) => {
    if (!req.user) {
      return sendUnauthorized(res, "Authentication required");
    }

    const userPermissions = req.user.permissions || [];
    const hasPermission = permissions.some((permission) =>
      userPermissions.includes(permission)
    );

    if (!hasPermission) {
      return sendForbidden(
        res,
        "You do not have permission to access this resource"
      );
    }

    next();
  };
};
