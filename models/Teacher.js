import mongoose from "mongoose";

const TeacherSchema = new mongoose.Schema(
  {
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
      unique: true,
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

export default mongoose.model("Teacher", TeacherSchema);
