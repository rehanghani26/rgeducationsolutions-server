import mongoose from 'mongoose';

const AttendanceSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true,
    default: Date.now
  },
  // Attendance Date: The specific calendar date for which the attendance applies (past date or today)
  attendanceDate: {
    type: Date,
    default: Date.now
  },
  // Attendance Taken Date: The exact timestamp when this attendance was recorded/submitted
  attendanceTakenDate: {
    type: Date,
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

// Non-unique index for fast filtering (allows multiple sections and updates)
AttendanceSchema.index({ date: 1, classId: 1, sectionId: 1 }, { sparse: true });
AttendanceSchema.index({ attendanceDate: 1, classId: 1 }, { sparse: true });
AttendanceSchema.index({ attendanceTakenDate: 1 });

export default mongoose.model('Attendance', AttendanceSchema);
