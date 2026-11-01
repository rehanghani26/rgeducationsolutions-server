import mongoose from 'mongoose';

const PayrollRecordSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    employeeId: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    staffName: {
      type: String,
      required: true,
      trim: true,
    },
    role: {
      type: String,
      required: true,
      trim: true,
    },
    designation: {
      type: String,
      default: '',
      trim: true,
    },
    department: {
      type: String,
      default: 'General',
      trim: true,
    },
    // Salary Components
    basicPay: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    hra: {
      type: Number,
      default: 0,
      min: 0,
    },
    da: {
      type: Number,
      default: 0,
      min: 0,
    },
    specialAllowance: {
      type: Number,
      default: 0,
      min: 0,
    },
    pfDeduction: {
      type: Number,
      default: 0,
      min: 0,
    },
    taxDeduction: {
      type: Number,
      default: 0,
      min: 0,
    },
    otherDeductions: {
      type: Number,
      default: 0,
      min: 0,
    },
    netPay: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    // Payment / Banking Info
    paymentMode: {
      type: String,
      enum: ['Bank Transfer', 'Cheque', 'Cash'],
      default: 'Bank Transfer',
    },
    bankName: {
      type: String,
      default: '',
      trim: true,
    },
    accountNumber: {
      type: String,
      default: '',
      trim: true,
    },
    ifscCode: {
      type: String,
      default: '',
      trim: true,
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'on-leave', 'suspended'],
      default: 'active',
    },
  },
  {
    timestamps: true,
  }
);

// Pre-save calculate net pay
PayrollRecordSchema.pre('save', function (next) {
  const gross =
    Number(this.basicPay || 0) +
    Number(this.hra || 0) +
    Number(this.da || 0) +
    Number(this.specialAllowance || 0);
  const deductions =
    Number(this.pfDeduction || 0) +
    Number(this.taxDeduction || 0) +
    Number(this.otherDeductions || 0);
  this.netPay = Math.max(0, gross - deductions);
  next();
});

export default mongoose.model('PayrollRecord', PayrollRecordSchema);

