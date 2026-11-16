import mongoose from "mongoose";

const SchoolSchema = new mongoose.Schema(
  {
    _id: {
      type: String, // Accepts custom central schoolId e.g. "SCH001", "SCH002"
      required: true,
    },
    schoolId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      uppercase: true,
      trim: true,
      immutable: true,
    },
    schoolName: {
      type: String,
      required: [true, "School name is required"],
      trim: true,
    },
    schoolCode: {
      type: String,
      unique: true,
      required: [true, "School code is required"],
      trim: true,
      uppercase: true,
      index: true,
    },
    // Optional collectionName kept for backward compatibility if referenced
    collectionName: {
      type: String,
      trim: true,
      lowercase: true,
    },
    contactEmail: {
      type: String,
      required: [true, "Official contact email is required"],
      trim: true,
      lowercase: true,
    },
    schoolPhone: {
      type: String,
      trim: true,
      default: "",
    },
    alternatePhone: {
      type: String,
      trim: true,
      default: "",
    },
    address: {
      addressLine1: { type: String, default: "" },
      addressLine2: { type: String, default: "" },
      city: { type: String, default: "" },
      state: { type: String, default: "" },
      country: { type: String, default: "India" },
      postalCode: { type: String, default: "" },
    },
    affiliationNumber: {
      type: String,
      default: "",
    },
    board: {
      type: String,
      default: "CBSE",
    },
    schoolLogo: {
      type: String,
      default: "",
    },
    schoolMotto: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["active", "suspended", "provisioning", "ACTIVE", "SUSPENDED"],
      default: "active",
    },
    subscriptionPlan: {
      type: String,
      enum: ["trial", "standard", "enterprise"],
      default: "standard",
    },
    primaryAdmin: {
      name: { type: String, default: "" },
      email: { type: String, default: "" },
      phone: { type: String, default: "" },
      userId: { type: String, default: "" },
    },
    metadata: {
      type: Map,
      of: String,
      default: {},
    },
  },
  {
    timestamps: true,
    _id: false, // Allows custom _id to be passed as string
  }
);

// Pre-save hook: ensure _id and schoolId are in sync
SchoolSchema.pre("validate", function (next) {
  if (!this._id && this.schoolId) {
    this._id = this.schoolId;
  } else if (this._id && !this.schoolId) {
    this.schoolId = this._id;
  }
  next();
});

// Immutability Guard: Reject any update attempting to alter schoolId
SchoolSchema.pre("findOneAndUpdate", function (next) {
  const update = this.getUpdate();
  if (
    update &&
    (update.schoolId !== undefined ||
      (update.$set && update.$set.schoolId !== undefined))
  ) {
    return next(
      new Error(
        "ValidationError: schoolId is permanent and CANNOT be changed after creation."
      )
    );
  }
  next();
});

export default mongoose.model("School", SchoolSchema);
