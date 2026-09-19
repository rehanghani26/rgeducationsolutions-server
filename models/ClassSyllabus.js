import mongoose from "mongoose";

const SyllabusSubjectSchema = new mongoose.Schema(
  {
    subjectName: { type: String, required: true, trim: true },
    subjectCode: { type: String, trim: true },
    bookName: { type: String, trim: true },
    author: { type: String, trim: true },
    publisher: { type: String, trim: true },
    maxMarks: { type: Number, default: 100 },
    passMarks: { type: Number, default: 35 },
  },
  { _id: true }
);

const ClassSyllabusSchema = new mongoose.Schema(
  {
    classId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    className: {
      type: String,
      required: true,
      trim: true,
    },
    academicYear: {
      type: String,
      default: () => {
        const yr = new Date().getFullYear();
        return `${yr}-${yr + 1}`;
      },
    },
    description: {
      type: String,
      trim: true,
    },
    subjects: [SyllabusSubjectSchema],
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  }
);

ClassSyllabusSchema.index({ classId: 1, academicYear: 1 }, { unique: true });

export default mongoose.model("ClassSyllabus", ClassSyllabusSchema);
