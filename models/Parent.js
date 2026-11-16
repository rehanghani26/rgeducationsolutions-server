import mongoose from 'mongoose';
import { createDynamicModelProxy } from "../utils/tenantContext.js";

const ParentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  name: { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true },
  email: { type: String, trim: true, lowercase: true },
  occupation: { type: String, trim: true },
  address: { type: String, trim: true },
  children: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student' }],
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
}, { timestamps: true });

const Parent = mongoose.models.Parent || mongoose.model('Parent', ParentSchema);
export default createDynamicModelProxy('Parent', Parent);
