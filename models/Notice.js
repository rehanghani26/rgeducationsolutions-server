import mongoose from 'mongoose';

const noticeSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    content: { type: String, required: true },
    category: { type: String, default: 'General' },
    icon: { type: String, default: '📢' },
    priority: { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
    targetRoles: [{ type: String, default: 'all' }],
    author: { type: String, default: 'Administration' },
    pinned: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const Notice = mongoose.models.Notice || mongoose.model('Notice', noticeSchema);
export default Notice;
