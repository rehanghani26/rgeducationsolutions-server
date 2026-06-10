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
    rollNumber: {
      type: String,
      required: true,
    },
    admissionNumber: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
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
    classId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Class",
    },
    sectionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Section",
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
    status: {
      type: String,
      enum: ["active", "inactive"],
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

export default mongoose.model("Student", StudentSchema);
