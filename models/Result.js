import mongoose from 'mongoose';

const SubjectMarkSchema = new mongoose.Schema({
  subjectId: { type: mongoose.Schema.Types.Mixed },
  subjectName: { type: String, required: true },
  subjectCode: { type: String },
  bookName: { type: String },
  obtained: { type: Number, required: true, min: 0 },
  maxMarks: { type: Number, required: true, default: 100 },
  passMarks: { type: Number, default: 35 },
  isPassed: { type: Boolean },
  grade: { type: String },
  gradePoint: { type: Number },
}, { _id: false });

const ResultSchema = new mongoose.Schema({
  examId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Exam',
    required: true,
  },
  examName: { type: String },
  examTerm: { type: String },
  examSession: { type: String },

  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true,
  },
  studentName: { type: String },
  studentEmail: { type: String },
  admissionNumber: { type: String },
  rollNumber: { type: Number },

  classId: { type: mongoose.Schema.Types.Mixed },
  className: { type: String },
  section: { type: String },

  // Subject-wise marks
  marks: [SubjectMarkSchema],

  // Computed fields
  totalObtained: { type: Number, default: 0 },
  totalMaxMarks: { type: Number, default: 0 },
  percentage: { type: Number, default: 0 },
  gpa: { type: Number },
  grade: { type: String },
  rank: { type: Number },
  isPassed: { type: Boolean, default: false },
  failedSubjects: [{ type: String }],

  remarks: { type: String },

  // Workflow status
  status: {
    type: String,
    enum: ['draft', 'published'],
    default: 'draft',
  },
  publishedAt: { type: Date },
  publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, {
  timestamps: true,
});

// Unique: one result per student per exam
ResultSchema.index({ examId: 1, studentId: 1 }, { unique: true });
ResultSchema.index({ studentId: 1, status: 1 });
ResultSchema.index({ examId: 1, classId: 1, status: 1 });

// Helper: calculate grade from percentage
ResultSchema.statics.calcGrade = function(pct) {
  if (pct >= 91) return { grade: 'A+', gpa: 10.0 };
  if (pct >= 81) return { grade: 'A',  gpa: 9.0  };
  if (pct >= 71) return { grade: 'B+', gpa: 8.0  };
  if (pct >= 61) return { grade: 'B',  gpa: 7.0  };
  if (pct >= 51) return { grade: 'C+', gpa: 6.0  };
  if (pct >= 41) return { grade: 'C',  gpa: 5.0  };
  if (pct >= 33) return { grade: 'D',  gpa: 4.0  };
  return { grade: 'F', gpa: 0.0 };
};

export default mongoose.model('Result', ResultSchema);
