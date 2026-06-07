import mongoose from "mongoose";

const SettingSchema = new mongoose.Schema(
  {
    // School Information
    schoolName: {
      type: String,
      default: "Aegis School & College ERP",
    },
    schoolCode: {
      type: String,
      default: "",
    },
    registrationNumber: {
      type: String,
      default: "",
    },
    affiliationNumber: {
      type: String,
      default: "",
    },
    schoolType: {
      type: String,
      enum: ["primary", "secondary", "senior", "college", "university"],
      default: "secondary",
    },
    establishedYear: {
      type: Number,
      default: new Date().getFullYear(),
    },
    academicYear: {
      type: String,
      default: "2026-2027",
    },

    // Contact Information
    contactEmail: {
      type: String,
      default: "admin@school.com",
    },
    schoolPhone: {
      type: String,
      default: "",
    },
    alternatePhone: {
      type: String,
      default: "",
    },
    websiteUrl: {
      type: String,
      default: "",
    },

    // Address Information
    addressLine1: {
      type: String,
      default: "",
    },
    addressLine2: {
      type: String,
      default: "",
    },
    city: {
      type: String,
      default: "",
    },
    state: {
      type: String,
      default: "",
    },
    country: {
      type: String,
      default: "",
    },
    postalCode: {
      type: String,
      default: "",
    },

    // Branding & Identity
    companyLogo: {
      type: String,
      default: "",
    },
    schoolLogo: {
      type: String,
      default: "",
    },
    schoolLogoPublicId: {
      type: String,
      default: "",
    },
    schoolLogoAssetId: {
      type: String,
      default: "",
    },
    schoolLogoName: {
      type: String,
      default: "",
    },
    schoolBanner: {
      type: String,
      default: "",
    },
    schoolBannerPublicId: {
      type: String,
      default: "",
    },
    schoolBannerAssetId: {
      type: String,
      default: "",
    },
    schoolBannerName: {
      type: String,
      default: "",
    },
    schoolMotto: {
      type: String,
      default: "",
    },
    principalName: {
      type: String,
      default: "",
    },
    currencySymbol: {
      type: String,
      default: "$",
    },

    // Teacher Settings
    autoGenerateTeacherID: {
      type: Boolean,
      default: true,
    },
    teacherIDPrefix: {
      type: String,
      default: "T",
    },
    maxTeachersPerClass: {
      type: Number,
      default: 5,
    },

    // Student Settings
    autoGenerateAdmissionNumber: {
      type: Boolean,
      default: true,
    },
    admissionNumberPrefix: {
      type: String,
      default: "STU",
    },
    defaultStudentPassword: {
      type: String,
      default: "password",
    },
    maxStudentsPerSection: {
      type: Number,
      default: 50,
    },

    // Inventory Settings
    enableInventoryTracking: {
      type: Boolean,
      default: true,
    },
    lowStockAlert: {
      type: Boolean,
      default: true,
    },
    lowStockThreshold: {
      type: Number,
      default: 10,
    },
    enableBarcode: {
      type: Boolean,
      default: false,
    },

    // Timesheet Settings
    enableTimesheet: {
      type: Boolean,
      default: true,
    },
    timesheetFrequency: {
      type: String,
      enum: ["daily", "weekly", "monthly"],
      default: "monthly",
    },
    overtimeMultiplier: {
      type: Number,
      default: 1.5,
    },
    attendanceRequirement: {
      type: Number,
      default: 85,
      min: 0,
      max: 100,
    },

    // Policy Settings
    enableLeavePolicy: {
      type: Boolean,
      default: true,
    },
    annualLeaveDays: {
      type: Number,
      default: 15,
    },
    sickLeaveDays: {
      type: Number,
      default: 10,
    },
    enablePerformanceReview: {
      type: Boolean,
      default: true,
    },
    reviewFrequency: {
      type: String,
      enum: ["monthly", "quarterly", "semi-annual", "annual"],
      default: "quarterly",
    },

    // Access Settings
    enableTwoFactor: {
      type: Boolean,
      default: false,
    },
    sessionTimeout: {
      type: Number,
      default: 30,
    },
    passwordExpiry: {
      type: Number,
      default: 90,
    },

    // Academic Settings
    defaultPassingPercentage: {
      type: Number,
      default: 40,
      min: 0,
      max: 100,
    },
    gradePointScale: {
      type: Number,
      default: 4.0,
    },
    enableGradeDistribution: {
      type: Boolean,
      default: true,
    },

    // Finance Settings
    enableInstallmentPayment: {
      type: Boolean,
      default: true,
    },
    lateFeesPercentage: {
      type: Number,
      default: 5,
    },
    enableAutoReminder: {
      type: Boolean,
      default: true,
    },
    reminderDaysBefore: {
      type: Number,
      default: 5,
    },

    // Notifications
    enableSmsAlerts: {
      type: Boolean,
      default: false,
    },
    enableEmailAlerts: {
      type: Boolean,
      default: true,
    },
    enablePushNotifications: {
      type: Boolean,
      default: false,
    },

    // Security Settings
    enableDataEncryption: {
      type: Boolean,
      default: true,
    },
    enableAuditLog: {
      type: Boolean,
      default: true,
    },

    // Backup Settings
    autoBackupEnabled: {
      type: Boolean,
      default: true,
    },
    backupFrequency: {
      type: String,
      enum: ["daily", "weekly", "monthly"],
      default: "daily",
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("Setting", SettingSchema);
