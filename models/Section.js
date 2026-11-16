import mongoose from 'mongoose';
import { createDynamicModelProxy } from "../utils/tenantContext.js";

const SectionSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    required: true
  },
  classTeacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Teacher'
  },
  room: {
    type: String
  },
  capacity: {
    type: Number,
    default: 35
  },
  enrolled: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Compound index to prevent duplicate section names in the same class
SectionSchema.index({ name: 1, classId: 1 }, { unique: true });

const Section = mongoose.models.Section || mongoose.model('Section', SectionSchema);
export default createDynamicModelProxy('Section', Section);
