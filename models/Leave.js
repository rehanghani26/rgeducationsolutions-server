import mongoose from "mongoose";

const LeaveSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.Mixed,
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
    },
    teacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Teacher",
    },
    applicantName: {
      type: String,
      required: true,
    },
    applicantRole: {
      type: String,
      enum: ["student", "teacher", "staff", "admin"],
      default: "student",
    },
    class: {
      type: String,
    },
    className: {
      type: String,
    },
    section: {
      type: String,
    },
    rollNumber: {
      type: mongoose.Schema.Types.Mixed,
    },
    category: {
      type: String,
      default: "Casual Leave",
    },
    reason: {
      type: String,
      required: true,
    },
    startDate: {
      type: String,
      required: true,
    },
    endDate: {
      type: String,
      required: true,
    },
    totalDays: {
      type: Number,
      default: 1,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "cancelled"],
      default: "pending",
    },
    reviewedBy: {
      type: String,
    },
    reviewedAt: {
      type: Date,
    },
    reviewRemarks: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

LeaveSchema.index({ studentId: 1, status: 1 });
LeaveSchema.index({ applicantRole: 1, status: 1 });
LeaveSchema.index({ startDate: 1, endDate: 1 });

export default mongoose.models.Leave || mongoose.model("Leave", LeaveSchema);

