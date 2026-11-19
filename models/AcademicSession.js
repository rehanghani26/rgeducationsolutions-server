import mongoose from 'mongoose';
import { createDynamicModelProxy } from "../utils/tenantContext.js";

const AcademicSessionSchema = new mongoose.Schema(
  {
    sessionName: {
      type: String,
      required: true,
      trim: true,
    }, // e.g. "2025-2026", "2026-2027"
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    isCurrent: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ['upcoming', 'active', 'completed'],
      default: 'upcoming',
    },
    notes: {
      type: String,
      default: '',
    },
    startClassId: { type: String },
    endClassId: { type: String },
    classIds: { type: [String], default: [] },
    setupConfirmedAt: { type: Date },
    previousSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicSession' },
    createdBy: {
      type: String,
      default: 'admin',
    },
    // ── Downstream linkage metadata (denormalized for fast stepper reads) ──
    hasMasterSchedule: {
      type: Boolean,
      default: false,
    },
    timetableCount: {
      type: Number,
      default: 0,
    },
    budgetVersion: { type: Number, default: 0, select: false },
  },
  { timestamps: true }
);

AcademicSessionSchema.index({ schoolId: 1, sessionName: 1 }, { unique: true });
AcademicSessionSchema.index({ schoolId: 1, startDate: 1, endDate: 1 });
AcademicSessionSchema.index(
  { schoolId: 1, isCurrent: 1 },
  { unique: true, partialFilterExpression: { isCurrent: true } }
);
AcademicSessionSchema.index(
  { schoolId: 1, previousSessionId: 1 },
  { unique: true, partialFilterExpression: { previousSessionId: { $type: 'objectId' } } }
);

const AcademicSession = mongoose.models.AcademicSession || mongoose.model('AcademicSession', AcademicSessionSchema);
export default createDynamicModelProxy('AcademicSession', AcademicSession);
