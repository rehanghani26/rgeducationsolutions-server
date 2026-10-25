import mongoose from 'mongoose';

/**
 * StudentSessionHistory — one record per student per academic session.
 *
 * Created when a student is enrolled into a ClassRoom for a session.
 * Updated (completedAt set, status → 'completed') when they are promoted,
 * demoted, transferred, or passed out.
 *
 * This gives you the full class timeline for any student by querying:
 *   StudentSessionHistory.find({ studentId }).sort({ enrolledAt: 1 })
 */
const StudentSessionHistorySchema = new mongoose.Schema(
  {
    // ── Student ───────────────────────────────────────────────────────────────
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
      index: true,
    },
    studentName: {
      type: String,
      trim: true,
      default: '',
    }, // denormalized
    admissionNumber: {
      type: String,
      trim: true,
      default: '',
    }, // denormalized — e.g. "STD-2026-0001"

    // ── Session ───────────────────────────────────────────────────────────────
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AcademicSession',
      required: true,
      index: true,
    },
    sessionName: {
      type: String,
      trim: true,
      default: '',
    }, // e.g. "2025-26"

    // ── Classroom snapshot ────────────────────────────────────────────────────
    classRoomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ClassRoom',
      default: null,
    },
    classId: {
      type: String,
      trim: true,
      default: '',
    }, // e.g. "cls-10"
    className: {
      type: String,
      trim: true,
      default: '',
    }, // e.g. "Class 10"
    sectionId: {
      type: String,
      trim: true,
      default: '',
    },
    sectionName: {
      type: String,
      trim: true,
      default: '',
    },
    rollNumber: {
      type: Number,
      default: null,
    },

    // ── Class teacher at the time of enrollment ───────────────────────────────
    classTeacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Teacher',
      default: null,
    },
    classTeacherName: {
      type: String,
      trim: true,
      default: '',
    },

    // ── How they arrived & left ───────────────────────────────────────────────
    action: {
      type: String,
      enum: ['enrolled', 'promoted', 'demoted', 'transferred', 'passout'],
      default: 'enrolled',
    },
    status: {
      type: String,
      enum: ['active', 'completed'],
      default: 'active',
      index: true,
    },

    enrolledAt: {
      type: Date,
      default: Date.now,
    },
    completedAt: {
      type: Date,
      default: null,
    },

    enrolledBy: {
      type: String,
      default: 'admin',
      trim: true,
    },
    completedBy: {
      type: String,
      default: null,
      trim: true,
    },
    notes: {
      type: String,
      default: '',
      trim: true,
    },
  },
  { timestamps: true }
);

// ── Unique: one active enrollment per student per session ─────────────────────
StudentSessionHistorySchema.index(
  { studentId: 1, sessionId: 1 },
  { unique: true }
);

export default mongoose.model('StudentSessionHistory', StudentSessionHistorySchema);
