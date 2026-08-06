import mongoose from 'mongoose';

const SectionSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    required: true
  },
  classTeacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Teacher'
  },
  room: {
    type: String
  },
  capacity: {
    type: Number,
    default: 35
  },
  enrolled: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Compound index to prevent duplicate section names in the same class
SectionSchema.index({ name: 1, classId: 1 }, { unique: true });

export default mongoose.model('Section', SectionSchema);
