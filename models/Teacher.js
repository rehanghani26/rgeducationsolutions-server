import mongoose from "mongoose";
import tenantPlugin from "../utils/tenantPlugin.js";
import { createDynamicModelProxy } from "../utils/tenantContext.js";

const teacherFileSchema = new mongoose.Schema({
  name: String,
  mimeType: String,
  data: String,
}, { _id: false });

const TeacherSchema = new mongoose.Schema(
  {
    schoolId: {
      type: String,
      required: [true, "schoolId is required for teacher isolation"],
      index: true,
      uppercase: true,
      trim: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    firstName: {
      type: String,
      required: true,
      trim: true,
    },
    lastName: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      trim: true,
    },
    employeeId: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    gender: {
      type: String,
      enum: ["Male", "Female", "Other", ""],
      default: "",
    },
    dob: {
      type: Date,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    alternatePhone: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    address: {
      type: String,
      trim: true,
    },
    bloodGroup: { type: String, trim: true, default: "" },
    emergencyContactName: { type: String, trim: true, default: "" },
    emergencyContactPhone: { type: String, trim: true, default: "" },
    emergencyContactRelation: { type: String, trim: true, default: "" },
    aadhaarNumber: { type: String, trim: true, default: "" },
    photoName: { type: String, default: "" },
    aadhaarFileName: { type: String, default: "" },
    photoFile: { type: teacherFileSchema, select: false },
    aadhaarFile: { type: teacherFileSchema, select: false },
    joiningDate: {
      type: Date,
      default: Date.now,
    },
    qualification: {
      type: String,
      trim: true,
    },
    designation: {
      type: String,
      required: true,
      trim: true,
    },
    department: {
      type: String,
      trim: true,
    },
    experience: {
      type: String,
      trim: true,
    },
    employmentType: { type: String, trim: true, default: "" },
    specialization: { type: String, trim: true, default: "" },
    subjectsAssigned: [
      {
        type: String
      },
    ],
    classesAssigned: [
      {
        type: String
      },
    ],
    sectionsAssigned: [
      {
        type: String
      },
    ],
    isClassTeacher: {
      type: Boolean,
      default: false,
    },
    // ── Current classroom assignment (added for ClassRoom module) ──
    currentClassRoomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ClassRoom',
      default: null,
    },
    currentClassRoomName: {
      type: String,
      default: '',
      trim: true,
    }, // e.g. "Class 10 – A (2025-26)" — denormalized
    salary: {
      type: Number,
      default: 0,
    },
    role: {
      type: String,
      enum: ["teacher", "head-teacher", "hod", "coordinator"],
      default: "teacher",
    },
    permissions: [
      {
        type: String,
        trim: true,
      },
    ],
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    accountExpiryDate: {
      type: Date,
    },
    loginRestriction: {
      type: String,
      enum: ["none", "school-network", "office-hours"],
      default: "none",
    },
    twoFactorEnabled: {
      type: Boolean,
      default: false,
    },
    forcePasswordChange: {
      type: Boolean,
      default: false,
    },
    attendanceRate: {
      type: Number,
      default: 100,
    },
    leaves: [
      {
        date: Date,
        reason: String,
        status: {
          type: String,
          enum: ["pending", "approved", "rejected"],
          default: "pending",
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Multi-tenant scoped compound index
TeacherSchema.index({ schoolId: 1, employeeId: 1 }, { unique: true });

TeacherSchema.plugin(tenantPlugin);

const Teacher = mongoose.models.Teacher || mongoose.model('Teacher', TeacherSchema);
export default createDynamicModelProxy('Teacher', Teacher);
