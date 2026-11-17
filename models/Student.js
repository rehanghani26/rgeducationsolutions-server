import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import tenantPlugin from "../utils/tenantPlugin.js";

const StudentSchema = new mongoose.Schema(
  {
    schoolId: {
      type: String,
      required: [true, "schoolId is required for student isolation"],
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
      trim: true,
    },
    lastName: {
      type: String,
      trim: true,
    },
    name: {
      type: String,
      required: true,
    },
    // Scoped per school via compound index
    admissionNumber: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    // Auto-assigned per class+section starting from 1
    rollNumber: {
      type: Number,
      default: null,
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    alternatePhone: {
      type: String,
      trim: true,
    },
    // Class info stored as both string name and string ID
    class: {
      type: String,
      default: null,
    },
    className: {
      type: String,
      default: null,
    },
    classId: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    // Section info stored as both string name and string ID
    section: {
      type: String,
      default: null,
    },
    sectionName: {
      type: String,
      default: null,
    },
    sectionId: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    // Academic year e.g. "2025-26"
    academicYear: {
      type: String,
      default: () => {
        const now = new Date();
        const yr = now.getFullYear();
        const month = now.getMonth(); // 0-indexed
        // Academic year starts April, so April 2026 = 2026-27
        return month >= 3
          ? `${yr}-${String(yr + 1).slice(-2)}`
          : `${yr - 1}-${String(yr).slice(-2)}`;
      },
    },
    // ── Current ClassRoom reference (added for ClassRoom module) ──
    currentClassRoomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ClassRoom',
      default: null,
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AcademicSession',
      default: null,
      index: true,
    },
    dob: {
      type: Date,
    },
    gender: {
      type: String,
      enum: ["Male", "Female", "Other"],
    },
    bloodGroup: {
      type: String,
    },
    address: {
      type: String,
    },
    contactNumber: {
      type: String,
    },
    parentName: {
      type: String,
    },
    parentContact: {
      type: String,
    },
    parentEmail: {
      type: String,
    },
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Parent",
    },
    aadhaarNumber: {
      type: String,
    },
    photo: {
      type: String,
      default: "",
    },
    aadhaarDocument: {
      type: String,
      default: "",
    },
    imagesRef: {
      id: { type: String, default: "" },
      img: { type: String, default: "" },
    },
    AdharRef: {
      id: { type: String, default: "" },
      pdf: { type: String, default: "" },
    },
    documents: [
      {
        name: String,
        url: String,
      },
    ],
    academicHistory: [
      {
        school: String,
        class: String,
        year: String,
        percentage: String,
      },
    ],
    role: {
      type: String,
      enum: ["student"],
      default: "student",
    },
    // Deprecated: Permissions are now governed 100% role-wise via RolePermission & roleAccessController
    permissions: [
      {
        type: String,
        trim: true,
      },
    ],
    promotionHistory: [
      {
        fromClass: String,
        toClass: String,
        fromSection: String,
        toSection: String,
        action: String, // 'promote', 'demote', 'passout', 'transfer'
        sessionName: String,
        sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicSession' }, // ← added
        classRoomId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClassRoom' },     // ← added
        promotedAt: { type: Date, default: Date.now },
        promotedBy: String,
      },
    ],
    status: {
      type: String,
      enum: ["active", "inactive", "Passout", "Pass Out", "graduated"],
      default: "active",
    },
    forcePasswordChange: {
      type: Boolean,
      default: false,
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
    password: {
      type: String,
      default: null,
    },
    tempPassword: {
      type: String,
      default: null,
    },
    refreshToken: {
      type: String,
      default: null,
    },
    lastLogin: {
      type: Date,
      default: null,
    },
    loginHistory: [
      {
        ip: String,
        userAgent: String,
        timestamp: { type: Date, default: Date.now },
      },
    ],
    failedLoginAttempts: {
      type: Number,
      default: 0,
    },
    lockUntil: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

StudentSchema.methods.comparePassword = async function (enteredPassword) {
  if (!enteredPassword || typeof enteredPassword !== 'string') return false;

  // 1. Check bcrypt hash
  if (this.password && (this.password.startsWith("$2a$") || this.password.startsWith("$2b$"))) {
    try {
      return await bcrypt.compare(enteredPassword, this.password);
    } catch (_e) {
      return false;
    }
  }

  // 2. Strict exact match against stored password or assigned temporary password
  if (this.password && enteredPassword === this.password) {
    return true;
  }
  if (this.tempPassword && enteredPassword === this.tempPassword) {
    return true;
  }

  return false;
};

// Compound index: roll number is unique within class+section+academicYear
StudentSchema.index(
  { classId: 1, sectionId: 1, rollNumber: 1, academicYear: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: { rollNumber: { $ne: null } },
  }
);

// Multi-tenant scoped compound indexes
StudentSchema.index({ schoolId: 1, admissionNumber: 1 }, { unique: true });
StudentSchema.index({ schoolId: 1, class: 1, section: 1 });

StudentSchema.plugin(tenantPlugin);

export default mongoose.model("Student", StudentSchema);
