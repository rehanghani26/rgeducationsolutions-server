import mongoose from 'mongoose';

/**
 * ClassRoom — a session-scoped instantiation of a Class + Section.
 *
 * One ClassRoom document exists per (sessionId × classId × sectionId).
 * It owns:
 *   • the class teacher assignment for that session
 *   • the enrolled student list for that session
 *   • a link to the session-specific ClassTimetable
 */
const ClassRoomSchema = new mongoose.Schema(
  {
    // ── Session reference ─────────────────────────────────────────────────────
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AcademicSession',
      required: true,
      index: true,
    },
    sessionName: {
      type: String,
      required: true,
      trim: true,
    }, // e.g. "2025-26" — denormalized for fast reads

    // ── Class & Section identity ──────────────────────────────────────────────
    classId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    }, // e.g. "cls-10"
    className: {
      type: String,
      required: true,
      trim: true,
    }, // e.g. "Class 10"
    sectionId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    }, // e.g. "sec-a"
    sectionName: {
      type: String,
      required: true,
      trim: true,
    }, // e.g. "Section A"
    displayName: {
      type: String,
      trim: true,
    }, // e.g. "Class 10 – A (2025-26)" — auto-set on save

    // ── Physical room ─────────────────────────────────────────────────────────
    room: {
      type: String,
      trim: true,
      default: '',
    },
    capacity: {
      type: Number,
      default: 40,
    },

    // ── Class Teacher ─────────────────────────────────────────────────────────
    classTeacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Teacher',
      default: null,
    },
    classTeacherName: {
      type: String,
      default: '',
      trim: true,
    }, // denormalized

    // ── Enrolled Students ─────────────────────────────────────────────────────
    students: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student',
      },
    ],
    studentCount: {
      type: Number,
      default: 0,
    }, // kept in sync with students.length

    // ── Linked academic resources ─────────────────────────────────────────────
    timetableId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ClassTimetable',
      default: null,
    },
    masterPeriodId: {
      type: String,
      default: '',
    }, // reference to MasterPeriod used for this session's timetable

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['active', 'completed', 'archived'],
      default: 'active',
    },

    createdBy: {
      type: String,
      default: 'admin',
    },
  },
  { timestamps: true }
);

// ── Unique: one class-section per session ─────────────────────────────────────
ClassRoomSchema.index(
  { sessionId: 1, classId: 1, sectionId: 1 },
  { unique: true }
);

// ── Auto-set displayName before save ─────────────────────────────────────────
ClassRoomSchema.pre('save', function (next) {
  if (!this.displayName) {
    const sec = this.sectionName.replace(/^Section\s*/i, '');
    this.displayName = `${this.className} – ${sec} (${this.sessionName})`;
  }
  // Keep studentCount in sync
  this.studentCount = Array.isArray(this.students) ? this.students.length : 0;
  next();
});

export default mongoose.model('ClassRoom', ClassRoomSchema);
