import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  schoolId: { type: String, required: true, unique: true, trim: true, uppercase: true, immutable: true },
  startClassId: { type: String, required: true, immutable: true },
  endClassId: { type: String, required: true, immutable: true },
  classIds: {
    type: [String], required: true, immutable: true,
    validate: (ids) => ids.length > 0,
  },
}, { timestamps: true });

export default mongoose.models.SchoolCurriculum || mongoose.model('SchoolCurriculum', schema);
