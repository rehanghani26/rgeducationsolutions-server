import mongoose from "mongoose";

const StudentSchema = new mongoose.Schema(
  {
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
    // Auto-generated globally unique: STD-2026-0001
    admissionNumber: {
      type: String,
      required: true,
      unique: true,
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
        action: String, // 'promote', 'demote', 'passout'
        sessionName: String,
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
  },
  {
    timestamps: true,
  }
);

// Compound index: roll number is unique within class+section+academicYear
StudentSchema.index(
  { classId: 1, sectionId: 1, rollNumber: 1, academicYear: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: { rollNumber: { $ne: null } },
  }
);

export default mongoose.model("Student", StudentSchema);
