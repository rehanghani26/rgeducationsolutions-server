import mongoose from 'mongoose';

const FeeSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true,
    unique: true
  },
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

export default mongoose.model('Fee', FeeSchema);
