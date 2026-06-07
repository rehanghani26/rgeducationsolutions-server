import mongoose from 'mongoose';

const ResultSchema = new mongoose.Schema({
  examId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Exam',
    required: true
  },
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  marks: [{
    subjectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subject',
      required: true
    },
    obtained: {
      type: Number,
      required: true
    },
    total: {
      type: Number,
      required: true,
      default: 100
    }
  }],
  gpa: {
    type: Number
  },
  remarks: {
    type: String
  }
}, {
  timestamps: true
});

ResultSchema.index({ examId: 1, studentId: 1 }, { unique: true });

export default mongoose.model('Result', ResultSchema);
