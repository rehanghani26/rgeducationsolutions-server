import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  schoolId: { type: String, required: true },
  sourceSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicSession', required: true },
  targetSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicSession' },
  status: { type: String, enum: ['pending', 'failed', 'completed'], default: 'pending' },
  approvedBy: String,
  approvedAt: Date,
  planVersion: String,
  startedAt: Date,
  completedAt: Date,
  promotedCount: Number,
  passoutCount: Number,
  error: String,
}, { timestamps: true });

schema.index({ schoolId: 1, sourceSessionId: 1 }, { unique: true });

export default mongoose.models.SessionRollover || mongoose.model('SessionRollover', schema);
