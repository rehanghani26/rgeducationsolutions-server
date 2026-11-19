import mongoose from 'mongoose';
import academicRecordPlugin from '../utils/academicRecordPlugin.js';

const schema = new mongoose.Schema({
  routeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transport', required: true },
  routeName: { type: String, required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  studentName: { type: String, required: true },
  className: { type: String, required: true },
  pickupStop: String,
}, { timestamps: true });

schema.plugin(academicRecordPlugin, { collection: 'transportAssignments' });
schema.index({ schoolId: 1, sessionId: 1, studentId: 1 }, { unique: true });
export default mongoose.models.TransportAssignment || mongoose.model('TransportAssignment', schema);
