import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;
const schema = new mongoose.Schema({
  schoolId: { type: String, required: true },
  sessionId: { type: ObjectId, ref: 'AcademicSession', required: true },
  sessionName: { type: String, required: true },
  studentId: { type: ObjectId, ref: 'Student', required: true },
  studentName: { type: String, required: true },
  admissionNumber: String,
  className: String,
  sectionName: String,
  hostelId: { type: ObjectId, ref: 'Hostel', required: true },
  hostelName: { type: String, required: true },
  roomId: { type: ObjectId, ref: 'HostelRoom', required: true },
  bedId: { type: ObjectId, required: true },
  block: String,
  room: { type: String, required: true },
  bed: { type: String, required: true },
  roomType: String,
  active: { type: Boolean, required: true },
  status: {
    type: String, required: true,
    enum: ['assigned', 'left', 'cancelled', 'transferred', 'continued', 'legacy'],
  },
  openedBy: { type: ObjectId, required: true },
  openedByName: String,
  assignedAt: Date,
  // Temporarily disabled with the attendance-style hostel workflow.
  // checkedInAt: Date,
  // checkedInBy: ObjectId,
  endedAt: Date,
  endedBy: ObjectId,
  endedByName: String,
  endedRecordedAt: Date,
  endReason: String,
  previousAllocationId: { type: ObjectId, ref: 'HostelAllocation' },
  legacyId: { type: ObjectId, ref: 'HostelOccupancy' },
}, { timestamps: true });

schema.index({ schoolId: 1, studentId: 1 }, { unique: true, partialFilterExpression: { active: true } });
schema.index({ schoolId: 1, bedId: 1 }, { unique: true, partialFilterExpression: { active: true } });
schema.index({ schoolId: 1, legacyId: 1 }, { unique: true, partialFilterExpression: { legacyId: { $type: 'objectId' } } });
schema.index({ schoolId: 1, sessionId: 1, hostelId: 1 });
schema.index({ schoolId: 1, active: 1, hostelId: 1 });
schema.index({ schoolId: 1, hostelId: 1, roomId: 1 });
schema.index({ schoolId: 1, studentId: 1, createdAt: -1 });
schema.index({ schoolId: 1, studentId: 1, endedAt: -1 });
schema.index({ schoolId: 1, bedId: 1, endedAt: -1 });
export default mongoose.model('HostelAllocation', schema);
