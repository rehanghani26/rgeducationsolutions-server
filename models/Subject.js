import mongoose from 'mongoose';

const SubjectSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  code: {
    type: String,
    required: true,
    unique: true
  },
  type: {
    type: String,
    enum: ['theory', 'practical'],
    default: 'theory'
  },
  credits: {
    type: Number,
    default: 3
  }
}, {
  timestamps: true
});

export default mongoose.model('Subject', SubjectSchema);
