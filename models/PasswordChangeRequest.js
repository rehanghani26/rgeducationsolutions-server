import mongoose from 'mongoose';

const passwordChangeRequestSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    userName: { type: String, required: true },
    userEmail: { type: String, required: true },
    userRole: { type: String, default: 'student' },
    admissionNumber: { type: String, default: '' },
    className: { type: String, default: '' },
    sectionName: { type: String, default: '' },
    requestedPassword: { type: String, required: true },
    notes: { type: String, default: '' },
    actionType: {
      type: String,
      enum: ['request', 'direct_admin_reset'],
      default: 'request',
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedByName: { type: String, default: '' },
    reviewedAt: { type: Date },
    adminNotes: { type: String, default: '' },
    historyLog: [
      {
        action: { type: String, required: true },
        performedBy: { type: String, default: '' },
        performedById: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        timestamp: { type: Date, default: Date.now },
        notes: { type: String, default: '' },
      },
    ],
  },
  { timestamps: true }
);

const PasswordChangeRequest =
  mongoose.models.PasswordChangeRequest ||
  mongoose.model('PasswordChangeRequest', passwordChangeRequestSchema);

export default PasswordChangeRequest;
