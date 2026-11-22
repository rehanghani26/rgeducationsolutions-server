import mongoose from 'mongoose';
import { createDynamicModelProxy } from "../utils/tenantContext.js";

const SubjectSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  code: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['theory', 'practical'],
    default: 'theory'
  },
  credits: {
    type: Number,
    default: 3
  },
  teacher: {
    type: String
  }
}, {
  timestamps: true
});

SubjectSchema.index({ schoolId: 1, code: 1 }, { unique: true });

const Subject = mongoose.models.Subject || mongoose.model('Subject', SubjectSchema);
export default createDynamicModelProxy('Subject', Subject);
