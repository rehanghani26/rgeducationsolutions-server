import mongoose from 'mongoose';

const SlotAllocationSchema = new mongoose.Schema({
  day: { type: String, required: true }, // e.g. 'monday', 'tuesday', etc.
  periodOrder: { type: Number, default: 1 },
  periodId: { type: String },
  periodType: { type: String, default: 'class' }, // 'class', 'prayer', 'lunch', 'recess', etc.
  customLabel: { type: String, default: '' },
  startTime: { type: String, default: '' },
  endTime: { type: String, default: '' },
  subject: { type: String, default: '' },
  teacherId: { type: String, default: '' },
  teacherName: { type: String, default: '' },
  roomNo: { type: String, default: '' },
});

const ClassTimetableSchema = new mongoose.Schema(
  {
    classSectionKey: {
      type: String,
      required: true,
      index: true,
    }, // e.g., "Class 10 - Section A"
    classId: { type: String, default: '', index: true }, // e.g., "cls-10"
    sectionId: { type: String, default: '', index: true }, // e.g., "sec-a"
    className: { type: String, default: '' },
    sectionName: { type: String, default: '' },
    scheduleType: {
      type: String,
      enum: ['regular', 'exam'],
      default: 'regular',
    },
    masterPeriodId: { type: String, default: '' },
    allocations: [SlotAllocationSchema],
    createdBy: { type: String, default: 'admin' },
  },
  { timestamps: true }
);

export default mongoose.model('ClassTimetable', ClassTimetableSchema);
