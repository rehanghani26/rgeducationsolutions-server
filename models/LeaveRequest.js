import mongoose from 'mongoose';

const LeaveRequestSchema = new mongoose.Schema(
  {
    // Unique human-readable reference code: LV-2026-0001
    leaveCode: {
      type: String,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },

    // Applicant Identification (Polymorphic: Student | Teacher | User)
    applicantId: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      index: true,
    },
    applicantModel: {
      type: String,
      enum: ['Student', 'Teacher', 'User'],
      required: true,
      default: 'Student',
      index: true,
    },
    applicantName: {
      type: String,
      required: true,
      trim: true,
    },
    applicantRole: {
      type: String,
      enum: [
        'student',
        'teacher',
        'head-teacher',
        'hod',
        'coordinator',
        'librarian',
        'accountant',
        'peon',
        'staff',
        'super-admin',
        'school-admin',
        'principal',
        'director',
      ],
      default: 'student',
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },

    // Optional Tenant / Organization Isolation
    organizationId: {
      type: String,
      default: 'default-school',
      index: true,
    },

    // Institutional / Class Context (Students & Class Teachers)
    admissionNumber: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    rollNumber: {
      type: mongoose.Schema.Types.Mixed,
      default: '',
    },
    employeeId: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    classRoomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ClassRoom',
      default: null,
      index: true,
    },
    className: {
      type: String,
      default: '',
      trim: true,
    },
    sectionName: {
      type: String,
      default: '',
      trim: true,
    },
    classSection: {
      type: String,
      default: '',
      trim: true,
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AcademicSession',
      default: null,
      index: true,
    },

    // Leave Category & Details
    category: {
      type: String,
      enum: [
        'Medical Leave',
        'Casual Leave',
        'Emergency Leave',
        'Family / Personal Event',
        'Academic Duty / Olympiad',
        'Maternity / Paternity',
        'Other',
      ],
      default: 'Medical Leave',
    },
    startDate: {
      type: Date,
      required: true,
      index: true,
    },
    endDate: {
      type: Date,
      required: true,
      index: true,
    },
    totalDays: {
      type: Number,
      required: true,
      default: 1,
      min: 0.5,
    },
    isHalfDay: {
      type: Boolean,
      default: false,
    },
    halfDaySession: {
      type: String,
      enum: ['first_half', 'second_half', 'none'],
      default: 'none',
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },

    // Supporting Documents (Cloudinary / File URL)
    documents: [
      {
        name: { type: String, default: '' },
        url: { type: String, default: '' },
        fileType: { type: String, default: '' },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],

    // Workflow State
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'cancelled'],
      default: 'pending',
      index: true,
    },
    appliedBy: {
      userId: { type: String, default: '' },
      name: { type: String, default: '' },
      role: { type: String, default: '' },
      appliedAt: { type: Date, default: Date.now },
    },
    reviewedBy: {
      userId: { type: String, default: '' },
      name: { type: String, default: '' },
      role: { type: String, default: '' },
      reviewedAt: { type: Date },
    },
    reviewRemarks: {
      type: String,
      default: '',
      trim: true,
    },

    // Bi-directional Attendance Reconciliation
    attendanceSync: {
      isSynced: { type: Boolean, default: false },
      syncedDates: [{ type: Date }],
      syncedAttendanceIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Attendance' }],
      syncedAt: { type: Date },
    },
  },
  {
    timestamps: true,
  }
);

// High-performance compound indexes
LeaveRequestSchema.index({ applicantId: 1, status: 1 });
LeaveRequestSchema.index({ user: 1, status: 1 });
LeaveRequestSchema.index({ startDate: 1, endDate: 1, status: 1 });
LeaveRequestSchema.index({ applicantModel: 1, status: 1 });
LeaveRequestSchema.index({ classRoomId: 1, status: 1 });
LeaveRequestSchema.index({ organizationId: 1, status: 1 });

export default mongoose.model('LeaveRequest', LeaveRequestSchema);
