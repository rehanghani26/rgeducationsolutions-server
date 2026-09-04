import mongoose from 'mongoose';

const PeriodSlotSchema = new mongoose.Schema({
  order: { type: Number, default: 1 },
  type: {
    type: String,
    default: 'class',
  },
  customLabel: { type: String, default: '' },
  startTime: { type: String, default: '07:00' },
  endTime:   { type: String, default: '08:00' },
  durationMinutes: { type: Number, default: 0 },
  subjectName: { type: String, default: '' },
  teacherName: { type: String, default: '' },
  roomNo:      { type: String, default: '' },
});

const MasterPeriodSchema = new mongoose.Schema(
  {
    scheduleType: {
      type: String,
      enum: ['regular', 'exam'],
      required: true,
      default: 'regular',
    },
    name: { type: String, default: 'Master Schedule' },
    schoolStartTime: { type: String, default: '07:00' },
    schoolEndTime:   { type: String, default: '14:00' },
    days: {
      type: [String],
      default: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
    },
    periods: [PeriodSlotSchema],
    isActive: { type: Boolean, default: true },
    createdBy: { type: String, default: 'admin' },
  },
  { timestamps: true, strict: false }
);

export default mongoose.model('MasterPeriod', MasterPeriodSchema);

