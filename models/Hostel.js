import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;
const schema = new mongoose.Schema({
  schoolId: { type: String, required: true },
  name: { type: String, required: true },
  nameKey: { type: String, required: true },
  contactPhone: String,
  address: String,
  category: { type: String, enum: ['boys', 'girls', 'coed'] },
  capacity: { type: Number, min: 1, validate: Number.isSafeInteger },
  description: String,
  wardens: [{ type: ObjectId, ref: 'User' }],
}, { timestamps: true });

schema.index({ schoolId: 1, nameKey: 1 }, { unique: true });
schema.index({ schoolId: 1, wardens: 1 });
export default mongoose.model('Hostel', schema);
