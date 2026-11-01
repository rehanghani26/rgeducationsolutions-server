// 7. Utilities
import { logActivity } from "../utils/activityLogger.js";

/**
 * @file auditLog.js
 * @description Automatic audit logging middleware for authenticated API requests.
 */

const SENSITIVE_KEYS = ["password", "confirmPassword", "refreshToken", "token"];

/**
 * Removes sensitive authentication fields before storing request payload in audit logs.
 *
 * @param {Record<string, any>} [body={}] - Request body.
 * @returns {Record<string, any>} Sanitized payload.
 */
const sanitizeBody = (body = {}) => {
  const clean = { ...body };
  SENSITIVE_KEYS.forEach((key) => delete clean[key]);
  return clean;
};

/**
 * Maps HTTP methods to human-readable audit actions.
 *
 * @param {string} method - HTTP method.
 * @returns {string} Audit action name.
 */
const methodToAction = (method) => {
  const map = {
    GET: "READ",
    POST: "CREATE",
    PUT: "UPDATE",
    PATCH: "UPDATE",
    DELETE: "DELETE",
  };
  return map[method] || "READ";
};

/**
 * Extracts the target module name from the request path.
 *
 * @param {string} [path=''] - Request path.
 * @returns {string} Module name.
 */
const extractModule = (path = "") => {
  const match = path.match(/\/api\/v1\/([^/?]+)/);
  return match ? match[1] : "system";
};

/**
 * Middleware that intercepts response completion and logs user activity.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @param {import('express').NextFunction} next - Express next middleware callback.
 */
export const auditMiddleware = (req, res, next) => {
  const start = Date.now();
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    if (req.user && !req.path.includes("/auth/login")) {
      const action = req.path.includes("/auth/logout")
        ? "LOGOUT"
        : methodToAction(req.method);

      logActivity({
        userId: req.user._id || req.user.id,
        action,
        module: extractModule(req.originalUrl || req.path),
        recordId: req.params?.id,
        details: `${req.method} ${req.originalUrl || req.path}`,
        ipAddress: req.ip || req.headers["x-forwarded-for"],
        userAgent: req.headers["user-agent"],
        metadata: {
          statusCode: res.statusCode,
          durationMs: Date.now() - start,
          body: ["POST", "PUT", "PATCH"].includes(req.method)
            ? sanitizeBody(req.body)
            : undefined,
        },
      });
    }
    return originalJson(body);
  };

  next();
};
