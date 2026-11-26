import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;
const bedSchema = new mongoose.Schema({
  label: { type: String, required: true },
  outOfService: { type: Boolean, default: false },
});
const schema = new mongoose.Schema({
  schoolId: { type: String, required: true },
  hostelId: { type: ObjectId, ref: 'Hostel', required: true },
  block: String,
  number: { type: String, required: true },
  roomKey: { type: String, required: true },
  roomType: String,
  features: String,
  beds: [bedSchema],
}, { timestamps: true });

schema.index({ schoolId: 1, hostelId: 1, roomKey: 1 }, { unique: true });
export default mongoose.model('HostelRoom', schema);
