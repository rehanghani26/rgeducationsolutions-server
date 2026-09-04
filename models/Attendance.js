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
    type: mongoose.Schema.Types.Mixed,
  },
  sectionId: {
    type: mongoose.Schema.Types.Mixed,
  },
  className: {
    type: String,
  },
  sectionName: {
    type: String,
  },
  classSection: {
    type: String,
  },
  takenBy: {
    userId: String,
    name: String,
  },
  total: Number,
  present: Number,
  absent: Number,
  late: Number,
  students: [{
    studentId: String,
    name: String,
    rollNo: mongoose.Schema.Types.Mixed,
    status: String,
    remarks: String,
  }],
}, {
  timestamps: true,
  strict: false
});

// Avoid having duplicate attendance logs for same class on the same day
AttendanceSchema.index({ date: 1, classId: 1, sectionId: 1 }, { sparse: true });

export default mongoose.model('Attendance', AttendanceSchema);
