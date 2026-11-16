import mongoose from 'mongoose';
import tenantContext, { createDynamicModelProxy } from "../utils/tenantContext.js";

const AuditLogSchema = new mongoose.Schema({
  schoolId: {
    type: String,
    default: () => tenantContext.getSchoolId() || 'GLOBAL',
    uppercase: true,
    trim: true,
    index: true,
  },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  action: {
    type: String,
    enum: ['CREATE', 'READ', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'EXPORT', 'BULK', 'PROMOTE', 'DEMOTE', 'ROLLBACK_PROMOTION'],
    required: true,
  },
  module: { type: String, required: true },
  recordId: { type: String },
  details: { type: String },
  ipAddress: { type: String },
  userAgent: { type: String },
  metadata: { type: mongoose.Schema.Types.Mixed },
  timestamp: { type: Date, default: Date.now },
}, { timestamps: false });

AuditLogSchema.index({ timestamp: -1 });
AuditLogSchema.index({ userId: 1 });
AuditLogSchema.index({ module: 1, recordId: 1 });

const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', AuditLogSchema);
export default createDynamicModelProxy('AuditLog', AuditLog);
