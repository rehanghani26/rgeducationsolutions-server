import mongoose from "mongoose";

const SubjectScheduleSchema = new mongoose.Schema(
  {
    subjectId: { type: mongoose.Schema.Types.ObjectId, ref: "Subject" },
    subjectName: { type: String, required: true },
    subjectCode: { type: String },
    bookName: { type: String },
    maxMarks: { type: Number, default: 100 },
    passMarks: { type: Number, default: 35 },
    examDate: { type: Date },
    startTime: { type: String },
    endTime: { type: String },
    room: { type: String },
  },
  { _id: false }
);

const ExamSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    term: {
      type: String,
      required: true,
      trim: true,
    },
    date: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
    },
    session: {
      type: String,
      default: () => {
        const yr = new Date().getFullYear();
        return `${yr}-${yr + 1}`;
      },
    },
    status: {
      type: String,
      enum: ["upcoming", "ongoing", "completed"],
      default: "upcoming",
    },
    // classes assigned to this exam
    classIds: [{ type: mongoose.Schema.Types.Mixed }],
    classNames: [{ type: String }],
    // subject schedule with marks config
    subjectSchedule: [SubjectScheduleSchema],
    // legacy simple arrays
    subjects: [{ type: String }],
    classes: [{ type: String }],
    totalMarks: { type: Number, default: 100 },
    passMarks: { type: Number, default: 35 },
    duration: { type: String },
    venue: { type: String },
    supervisor: { type: String },
    description: { type: String, trim: true },
    isPublished: { type: Boolean, default: false },
    publishedAt: { type: Date },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("Exam", ExamSchema);
