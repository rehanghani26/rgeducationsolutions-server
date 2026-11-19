import academicRecordPlugin from '../utils/academicRecordPlugin.js';
import mongoose from 'mongoose';
import { createDynamicModelProxy } from "../utils/tenantContext.js";

const NotificationSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  date: {
    type: Date,
    default: Date.now
  },
  type: {
    type: String,
    enum: ['academic', 'inventory', 'finance', 'general'],
    default: 'general'
  },
  roleVisibility: [{
    type: String,
    enum: ['super-admin', 'school-admin', 'principal', 'teacher', 'accountant', 'librarian', 'student', 'parent']
  }]
}, {
  timestamps: true
});

NotificationSchema.plugin(academicRecordPlugin, { collection: 'notifications' });

const Notification = mongoose.models.Notification || mongoose.model('Notification', NotificationSchema);
export default createDynamicModelProxy('Notification', Notification);
