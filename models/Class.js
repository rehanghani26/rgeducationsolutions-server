import mongoose from 'mongoose';
import { createDynamicModelProxy } from "../utils/tenantContext.js";

const ClassSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  code: {
    type: String,
    required: true,
    unique: true
  },
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

const Class = mongoose.models.Class || mongoose.model('Class', ClassSchema);
export default createDynamicModelProxy('Class', Class);
