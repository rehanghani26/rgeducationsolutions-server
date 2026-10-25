import mongoose from 'mongoose';

/**
 * ClassTeacherHistory — one record every time a teacher is assigned to or
 * removed from a ClassRoom as the class teacher.
 *
 * isCurrent: true  → teacher is actively serving as class teacher right now.
 * isCurrent: false → historical record; removedAt is set.
 */
const ClassTeacherHistorySchema = new mongoose.Schema(
  {
    // ── Who ───────────────────────────────────────────────────────────────────
    teacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Teacher',
      required: true,
      index: true,
    },
    teacherName: {
      type: String,
      trim: true,
      default: '',
    }, // denormalized
    teacherEmployeeId: {
      type: String,
      trim: true,
      default: '',
    }, // denormalized — e.g. "EMP-001"

    // ── Which classroom ───────────────────────────────────────────────────────
    classRoomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ClassRoom',
      required: true,
      index: true,
    },
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
    },
    classId: {
      type: String,
      trim: true,
      default: '',
    },
    className: {
      type: String,
      trim: true,
      default: '',
    },
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

    // ── Timeline ──────────────────────────────────────────────────────────────
    assignedAt: {
      type: Date,
      default: Date.now,
    },
    removedAt: {
      type: Date,
      default: null,
    },
    isCurrent: {
      type: Boolean,
      default: true,
      index: true,
    },

    assignedBy: {
      type: String,
      default: 'admin',
      trim: true,
    },
    removedBy: {
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

export default mongoose.model('ClassTeacherHistory', ClassTeacherHistorySchema);
