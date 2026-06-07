import mongoose from 'mongoose';

const AttendanceSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true,
    default: Date.now
  },
  type: {
    type: String,
    enum: ['student', 'teacher'],
    default: 'student'
  },
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class'
  },
  records: [{
    memberId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: 'memberModel'
    },
    memberModel: {
      type: String,
      required: true,
      enum: ['Student', 'Teacher', 'User']
    },
    status: {
      type: String,
      enum: ['present', 'absent', 'late', 'half-day'],
      default: 'present'
    }
  }]
}, {
  timestamps: true
});

// Avoid having duplicate attendance logs for same class on the same day
AttendanceSchema.index({ date: 1, classId: 1 }, { unique: true });

export default mongoose.model('Attendance', AttendanceSchema);
