import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  schoolId: String,
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicSession' },
  classId: String,
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  studentName: { type: String, required: true },
  className: { type: String, required: true },
  block: { type: String, required: true },
  room: { type: String, required: true },
  bed: { type: String, required: true },
  reviewedAt: Date,
  reviewedBy: mongoose.Schema.Types.ObjectId,
  reviewReason: String,
}, { timestamps: true });

schema.index({ schoolId: 1, sessionId: 1, studentId: 1 }, { unique: true });
schema.index({ schoolId: 1, sessionId: 1, block: 1, room: 1, bed: 1 }, { unique: true });
export default mongoose.models.HostelOccupancy || mongoose.model('HostelOccupancy', schema);
