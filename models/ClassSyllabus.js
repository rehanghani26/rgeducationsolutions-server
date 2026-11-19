import academicRecordPlugin from '../utils/academicRecordPlugin.js';
import mongoose from "mongoose";
import { createDynamicModelProxy } from "../utils/tenantContext.js";

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

ClassSyllabusSchema.index({ schoolId: 1, classId: 1, sessionId: 1 }, {
  unique: true, partialFilterExpression: { sessionId: { $type: 'objectId' } },
});

ClassSyllabusSchema.plugin(academicRecordPlugin, { collection: 'syllabus' });

const ClassSyllabus = mongoose.models.ClassSyllabus || mongoose.model('ClassSyllabus', ClassSyllabusSchema);
export default createDynamicModelProxy('ClassSyllabus', ClassSyllabus);
