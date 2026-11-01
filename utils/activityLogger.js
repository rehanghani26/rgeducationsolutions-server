// 3. Configuration
import { checkFallback } from "../config/db.js";

// 4. Models
import AuditLog from "../models/AuditLog.js";

// 6. Services
import { FallbackDb } from "../services/dbFallback.js";

/**
 * @file activityLogger.js
 * @description Centralized activity and audit logging helper for database and fallback modes.
 */

/**
 * Logs a system or user activity to MongoDB or FallbackDb.
 *
 * @param {Object} params
 * @param {string} [params.userId] - User ID who triggered the action.
 * @param {string} params.action - Action verb (CREATE, UPDATE, DELETE, etc.).
 * @param {string} params.module - Subsystem/module name.
 * @param {string} [params.recordId] - Affected record ID.
 * @param {string} [params.details] - Human-readable details.
 * @param {string} [params.ipAddress] - Client IP address.
 * @param {string} [params.userAgent] - Client User Agent.
 * @param {Record<string, any>} [params.metadata] - Extra structured metadata.
 * @returns {Promise<void>}
 */
export const logActivity = async ({
  userId,
  action,
  module,
  recordId,
  details,
  ipAddress,
  userAgent,
  metadata,
}) => {
  const entry = {
    userId: userId || null,
    action,
    module,
    recordId: recordId ? String(recordId) : undefined,
    details,
    ipAddress,
    userAgent,
    metadata,
    timestamp: new Date(),
  };

  try {
    if (checkFallback()) {
      FallbackDb.create("auditLogs", entry);
    } else {
      await AuditLog.create(entry);
    }
  } catch (err) {
    console.error("Activity log error:", err.message);
  }
};

/**
 * Retrieves activity logs for a specific record.
 *
 * @param {string} module - Target module name.
 * @param {string|number} recordId - Record identifier.
 * @param {number} [limit=50] - Maximum records to return.
 * @returns {Promise<Array<Object>>} Activity records.
 */
export const getRecordActivity = async (module, recordId, limit = 50) => {
  if (checkFallback()) {
    return FallbackDb.find("auditLogs")
      .filter(
        (log) => log.module === module && log.recordId === String(recordId)
      )
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);
  }
  return AuditLog.find({ module, recordId: String(recordId) })
    .populate("userId", "name email role")
    .sort({ timestamp: -1 })
    .limit(limit);
};
