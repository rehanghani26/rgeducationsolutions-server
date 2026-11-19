import academicRecordPlugin from '../utils/academicRecordPlugin.js';
import mongoose from 'mongoose';
import { createDynamicModelProxy } from "../utils/tenantContext.js";

const FeeSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  className: String,
  amountPaid: {
    type: Number,
    required: true,
    default: 0
  },
  amountPending: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['paid', 'partial', 'unpaid'],
    default: 'unpaid'
  },
  dueDate: {
    type: Date,
    required: true
  },
  transactions: [{
    date: {
      type: Date,
      default: Date.now
    },
    amount: Number,
    method: {
      type: String,
      enum: ['Cash', 'Cheque', 'Online', 'Bank Transfer'],
      default: 'Online'
    },
    reference: String
  }]
}, {
  timestamps: true
});

FeeSchema.plugin(academicRecordPlugin, { collection: 'fees' });

FeeSchema.index({ schoolId: 1, studentId: 1, sessionId: 1 }, {
  unique: true, partialFilterExpression: { sessionId: { $type: 'objectId' } },
});

const Fee = mongoose.models.Fee || mongoose.model('Fee', FeeSchema);
export default createDynamicModelProxy('Fee', Fee);
