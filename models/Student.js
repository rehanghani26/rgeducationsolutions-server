import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { currentAcademicYear } from "../utils/studentUtil.js";
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
      default: () => currentAcademicYear(),
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

    // ── 1. Admission & Previous School Fields ──
    admissionDate: {
      type: Date,
      default: Date.now,
    },
    joiningDate: {
      type: Date,
      default: Date.now,
    },
    isLegacyStudent: {
      type: Boolean,
      default: false,
    },
    admissionType: {
      type: String,
      trim: true,
      default: "New Admission",
    },
    previousSchoolName: {
      type: String,
      trim: true,
      default: "",
    },
    previousClass: {
      type: String,
      trim: true,
      default: "",
    },
    previousBoard: {
      type: String,
      trim: true,
      default: "",
    },
    transferCertificateNumber: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    transferCertificateDate: {
      type: Date,
      default: null,
    },
    enrollmentStatus: {
      type: String,
      trim: true,
      default: "Enrolled",
    },

    // ── 2. Academic & Student Profile Fields ──
    houseName: {
      type: String,
      trim: true,
      default: "",
    },
    studentCategory: {
      type: String,
      trim: true,
      default: "General",
    },
    nationality: {
      type: String,
      trim: true,
      default: "Indian",
    },
    motherTongue: {
      type: String,
      trim: true,
      default: "Hindi",
    },
    mediumOfInstruction: {
      type: String,
      trim: true,
      default: "English",
    },
    studentType: {
      type: String,
      trim: true,
      default: "Day Scholar",
    },
    specialEducationNeeds: {
      type: String,
      trim: true,
      default: "None",
    },
    careerInterest: {
      type: String,
      trim: true,
      default: "",
    },

    // ── 3. Family & Guardian Fields ──
    fatherName: {
      type: String,
      trim: true,
      default: "",
    },
    fatherOccupation: {
      type: String,
      trim: true,
      default: "",
    },
    fatherOrganization: {
      type: String,
      trim: true,
      default: "",
    },
    motherName: {
      type: String,
      trim: true,
      default: "",
    },
    motherContact: {
      type: String,
      trim: true,
      default: "",
    },
    motherOccupation: {
      type: String,
      trim: true,
      default: "",
    },
    guardianRelation: {
      type: String,
      trim: true,
      default: "",
    },
    guardianAddress: {
      type: String,
      trim: true,
      default: "",
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
