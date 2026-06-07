import AuditLog from '../models/AuditLog.js';
import { checkFallback } from '../config/db.js';
import { FallbackDb } from '../services/dbFallback.js';

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
      FallbackDb.create('auditLogs', entry);
    } else {
      await AuditLog.create(entry);
    }
  } catch (err) {
    console.error('Activity log error:', err.message);
  }
};

export const getRecordActivity = async (module, recordId, limit = 50) => {
  if (checkFallback()) {
    return FallbackDb.find('auditLogs')
      .filter((log) => log.module === module && log.recordId === String(recordId))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);
  }
  return AuditLog.find({ module, recordId: String(recordId) })
    .populate('userId', 'name email role')
    .sort({ timestamp: -1 })
    .limit(limit);
};
