import mongoose from 'mongoose';

const ExamSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  term: {
    type: String,
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['upcoming', 'ongoing', 'completed'],
    default: 'upcoming'
  },
  subjects: [{ type: String }],
  classes: [{ type: String }],
  description: { type: String, trim: true },
}, {
  timestamps: true
});

export default mongoose.model('Exam', ExamSchema);
