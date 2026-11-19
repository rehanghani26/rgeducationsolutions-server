import mongoose from 'mongoose';
import { createDynamicModelProxy } from "../utils/tenantContext.js";

const ClassSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  code: {
    type: String,
    required: true,
    trim: true
  },
  sortOrder: { type: Number, min: 0 },
  room: {
    type: String
  },
  capacity: {
    type: Number,
    default: 40
  }
}, {
  timestamps: true
});

ClassSchema.index({ schoolId: 1, code: 1 }, { unique: true });
ClassSchema.index({ schoolId: 1, name: 1 }, { unique: true });

const Class = mongoose.models.Class || mongoose.model('Class', ClassSchema);
export default createDynamicModelProxy('Class', Class);
