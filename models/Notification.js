import mongoose from 'mongoose';

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

export default mongoose.model('Notification', NotificationSchema);
