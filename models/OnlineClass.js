import mongoose from 'mongoose';

const ResourceSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true },
    url: { type: String, trim: true },
    type: {
      type: String,
      enum: ['document', 'video', 'link', 'note', 'other'],
      default: 'link',
    },
  },
  { _id: false }
);

const AttendanceSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
    studentId: { type: String, trim: true },
    studentName: { type: String, trim: true },
    admissionNumber: { type: String, trim: true },
    joinedAt: { type: Date, default: Date.now },
    leftAt: Date,
    status: {
      type: String,
      enum: ['registered', 'attended', 'absent'],
      default: 'attended',
    },
  },
  { timestamps: true }
);

const OnlineClassSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    subject: { type: String, required: true, trim: true },
    agenda: { type: String, trim: true },
    classId: { type: mongoose.Schema.Types.Mixed, default: null },
    className: { type: String, required: true, trim: true },
    sectionId: { type: mongoose.Schema.Types.Mixed, default: null },
    sectionName: { type: String, default: 'All Sections', trim: true },
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher' },
    teacherUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    teacherName: { type: String, required: true, trim: true },
    scheduledDate: { type: Date, required: true },
    startTime: { type: String, required: true, trim: true },
    endTime: { type: String, required: true, trim: true },
    timezone: { type: String, default: 'Asia/Kolkata', trim: true },
    platform: {
      type: String,
      enum: ['Zoom', 'Google Meet', 'Microsoft Teams', 'YouTube Live', 'School LMS', 'Other'],
      default: 'Google Meet',
    },
    meetingLink: { type: String, required: true, trim: true },
    meetingId: { type: String, trim: true },
    passcode: { type: String, trim: true },
    capacity: { type: Number, default: 60 },
    status: {
      type: String,
      enum: ['scheduled', 'live', 'completed', 'cancelled'],
      default: 'scheduled',
    },
    resources: [ResourceSchema],
    attendance: [AttendanceSchema],
    createdBy: { type: mongoose.Schema.Types.Mixed },
    updatedBy: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

OnlineClassSchema.index({ className: 1, sectionName: 1, scheduledDate: 1 });
OnlineClassSchema.index({ teacherUser: 1, scheduledDate: 1 });
OnlineClassSchema.index({ status: 1, scheduledDate: 1 });

export default mongoose.model('OnlineClass', OnlineClassSchema);
