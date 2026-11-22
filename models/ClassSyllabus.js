import academicRecordPlugin from '../utils/academicRecordPlugin.js';
import mongoose from "mongoose";
import { createDynamicModelProxy } from "../utils/tenantContext.js";

const BookSchema = new mongoose.Schema({
  title: { type: String, required: true },
  author: String,
  publisher: String,
  edition: String,
  isbn: String,
  required: Boolean,
  catalogBookId: String,
}, { _id: false });

const ChapterSchema = new mongoose.Schema({
  id: { type: String, required: true },
  title: { type: String, required: true },
  term: String,
}, { _id: false });

const SyllabusSubjectSchema = new mongoose.Schema(
  {
    subjectName: { type: String, required: true, trim: true },
    subjectId: String,
    subjectCode: { type: String, trim: true },
    bookName: { type: String, trim: true },
    author: { type: String, trim: true },
    publisher: { type: String, trim: true },
    maxMarks: { type: Number, default: 100 },
    passMarks: { type: Number, default: 35 },
    books: { type: [BookSchema], default: undefined },
    chapters: { type: [ChapterSchema], default: undefined },
  },
  { _id: true }
);

const PublishedSyllabusSchema = new mongoose.Schema({
  version: Number,
  description: String,
  subjects: [SyllabusSubjectSchema],
  publishedAt: Date,
  publishedBy: String,
}, { _id: false });

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
    status: { type: String, enum: ['draft', 'in-review', 'published'] },
    revision: { type: Number, default: 0 },
    reviewNote: String,
    published: PublishedSyllabusSchema,
    history: { type: [PublishedSyllabusSchema], default: undefined },
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
