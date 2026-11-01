// 3. Configuration
import { checkFallback } from "../config/db.js";

// 4. Models
import AuditLog from "../models/AuditLog.js";
import User from "../models/User.js";

// 6. Services
import { FallbackDb } from "../services/dbFallback.js";

// 7. Utilities
import { paginateResult, parsePagination } from "../utils/paginateQuery.js";
import {
  sendError,
  sendNotFound,
  sendSuccess,
} from "../utils/responseUtil.js";

/**
 * @file auditLogController.js
 * @description Controller for audit logs, login histories, and entity activity tracking.
 */

/**
 * Retrieves paginated audit logs with search and filtering.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 */
export const getLogs = async (req, res) => {
  try {
    const { page, limit, skip, search } = parsePagination(req.query);
    const { module, action, userId } = req.query;

    if (checkFallback()) {
      let logs = FallbackDb.find("auditLogs") || [];
      if (module) logs = logs.filter((l) => l.module === module);
      if (action) logs = logs.filter((l) => l.action === action);
      if (userId) logs = logs.filter((l) => l.userId === userId);
      if (search) {
        const term = search.toLowerCase();
        logs = logs.filter((l) =>
          (l.details || "").toLowerCase().includes(term)
        );
      }
      logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      const total = logs.length;
      const data = logs.slice(skip, skip + limit);
      return sendSuccess(res, undefined, null, 200, {
        ...paginateResult(data, total, { page, limit }),
      });
    }

    const filter = {};
    if (module) filter.module = module;
    if (action) filter.action = action;
    if (userId) filter.userId = userId;
    if (search) filter.details = new RegExp(search, "i");

    const [data, total] = await Promise.all([
      AuditLog.find(filter)
        .populate("userId", "name email role")
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit),
      AuditLog.countDocuments(filter),
    ]);

    return sendSuccess(res, undefined, null, 200, {
      ...paginateResult(data, total, { page, limit }),
    });
  } catch (error) {
    console.error("getLogs error:", error);
    return sendError(res, "Server error", 500);
  }
};

/**
 * Retrieves user login history.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 */
export const getLoginHistory = async (req, res) => {
  try {
    const { userId } = req.params;

    if (checkFallback()) {
      const user = FallbackDb.findById("users", userId);
      return sendSuccess(res, undefined, null, 200, {
        history: user?.loginHistory || [],
      });
    }

    const user = await User.findById(userId).select(
      "loginHistory lastLogin name email"
    );
    if (!user) return sendNotFound(res, "User not found");

    return sendSuccess(res, undefined, null, 200, {
      lastLogin: user.lastLogin,
      history: user.loginHistory || [],
    });
  } catch (error) {
    console.error("getLoginHistory error:", error);
    return sendError(res, "Server error", 500);
  }
};

/**
 * Retrieves activity logs for a specific module record.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 */
export const getRecordActivity = async (req, res) => {
  try {
    const { module, recordId } = req.params;
    const limit = Math.min(100, parseInt(req.query.limit, 10) || 50);

    if (checkFallback()) {
      const logs = (FallbackDb.find("auditLogs") || [])
        .filter((l) => l.module === module && l.recordId === recordId)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, limit);
      return sendSuccess(res, undefined, null, 200, { logs });
    }

    const logs = await AuditLog.find({ module, recordId })
      .populate("userId", "name email role")
      .sort({ timestamp: -1 })
      .limit(limit);

    return sendSuccess(res, undefined, null, 200, { logs });
  } catch (error) {
    console.error("getRecordActivity error:", error);
    return sendError(res, "Server error", 500);
  }
};
