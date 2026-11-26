import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;
const schema = new mongoose.Schema({
  schoolId: { type: String, required: true },
  hostelId: { type: ObjectId, ref: 'Hostel', required: true },
  hostelName: String,
  roomId: { type: ObjectId, ref: 'HostelRoom' },
  room: String,
  block: String,
  event: { type: String, enum: ['hostelCreated', 'hostelUpdated', 'roomCreated', 'roomUpdated'], required: true },
  actorId: { type: ObjectId, ref: 'User', required: true },
  actorName: String,
}, { timestamps: true });

schema.index({ schoolId: 1, hostelId: 1, roomId: 1 });
schema.index({ schoolId: 1, createdAt: -1 });
export default mongoose.model('HostelEvent', schema);
