import mongoose from 'mongoose';

const AttachmentSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true },
    url: { type: String, trim: true },
    type: {
      type: String,
      enum: ['document', 'image', 'video', 'link', 'other'],
      default: 'link',
    },
  },
  { _id: false }
);

const SubmissionSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
    studentId: { type: String, trim: true },
    studentName: { type: String, trim: true },
    admissionNumber: { type: String, trim: true },
    content: { type: String, trim: true },
    attachments: [AttachmentSchema],
    submittedAt: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: ['submitted', 'late', 'graded', 'returned'],
      default: 'submitted',
    },
    marks: { type: Number, default: null },
    feedback: { type: String, trim: true },
    gradedAt: Date,
    gradedBy: { type: String, trim: true },
  },
  { timestamps: true }
);

const HomeworkSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    subject: { type: String, required: true, trim: true },
    instructions: { type: String, required: true, trim: true },
    classId: { type: mongoose.Schema.Types.Mixed, default: null },
    className: { type: String, required: true, trim: true },
    sectionId: { type: mongoose.Schema.Types.Mixed, default: null },
    sectionName: { type: String, default: 'All Sections', trim: true },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher' },
    assignedByUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    teacherName: { type: String, required: true, trim: true },
    issueDate: { type: Date, default: Date.now },
    dueDate: { type: Date, required: true },
    totalMarks: { type: Number, default: 10 },
    priority: {
      type: String,
      enum: ['low', 'normal', 'high'],
      default: 'normal',
    },
    status: {
      type: String,
      enum: ['draft', 'published', 'closed'],
      default: 'published',
    },
    attachments: [AttachmentSchema],
    submissions: [SubmissionSchema],
    createdBy: { type: mongoose.Schema.Types.Mixed },
    updatedBy: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

HomeworkSchema.index({ className: 1, sectionName: 1, dueDate: 1 });
HomeworkSchema.index({ assignedByUser: 1, dueDate: 1 });
HomeworkSchema.index({ status: 1, dueDate: 1 });

export default mongoose.model('Homework', HomeworkSchema);
