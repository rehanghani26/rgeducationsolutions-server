import mongoose from "mongoose";

const PortalInquirySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    studentName: {
      type: String,
      default: "",
    },
    gradeApplyingFor: {
      type: String,
      default: "Grade 1",
    },
    subject: {
      type: String,
      default: "General Admission Inquiry",
    },
    message: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["new", "contacted", "enrolled", "closed"],
      default: "new",
    },
    adminNotes: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("PortalInquiry", PortalInquirySchema);
