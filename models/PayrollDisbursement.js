import mongoose from 'mongoose';

const PayrollDisbursementSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
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
    },
    designation: {
      type: String,
      default: '',
    },
    department: {
      type: String,
      default: '',
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AcademicSession',
      required: true,
    },
    sessionName: {
      type: String,
      default: '',
    },
    month: {
      type: String,
      required: true, // e.g. "October 2026"
    },
    monthNumber: {
      type: Number,
      required: true, // 10
    },
    year: {
      type: Number,
      required: true, // 2026
    },

    // ── Attendance & Leave Integration Metrics ──
    totalDaysInMonth: {
      type: Number,
      default: 30,
    },
    workingDays: {
      type: Number,
      default: 26,
    },
    presentDays: {
      type: Number,
      default: 26,
    },
    paidLeaveDays: {
      type: Number,
      default: 0,
    },
    unpaidLeaveDays: {
      type: Number,
      default: 0,
    },
    absentDays: {
      type: Number,
      default: 0,
    },
    halfDays: {
      type: Number,
      default: 0,
    },
    lateDays: {
      type: Number,
      default: 0,
    },
    lopDays: {
      type: Number,
      default: 0, // Loss of Pay days = unpaidLeaveDays + absentDays + (0.5 * halfDays)
    },
    perDayRate: {
      type: Number,
      default: 0,
    },
    lopDeduction: {
      type: Number,
      default: 0, // Monetary deduction for Loss of Pay
    },

    // ── Financial Breakdown ──
    basicPay: {
      type: Number,
      required: true,
      default: 0,
    },
    hra: {
      type: Number,
      default: 0,
    },
    da: {
      type: Number,
      default: 0,
    },
    specialAllowance: {
      type: Number,
      default: 0,
    },
    bonus: {
      type: Number,
      default: 0,
    },
    allowances: {
      type: Number,
      default: 0,
    },
    grossPay: {
      type: Number,
      default: 0,
    },
    pfDeduction: {
      type: Number,
      default: 0,
    },
    taxDeduction: {
      type: Number,
      default: 0,
    },
    otherDeductions: {
      type: Number,
      default: 0,
    },
    customDeduction: {
      type: Number,
      default: 0,
    },
    statutoryDeductions: {
      type: Number,
      default: 0,
    },
    deductions: {
      type: Number,
      default: 0, // Total Deductions = statutoryDeductions + lopDeduction
    },
    netPay: {
      type: Number,
      required: true,
      default: 0,
    },

    // Disbursement details
    paymentMethod: {
      type: String,
      enum: ['Bank Transfer', 'Cheque', 'Cash'],
      default: 'Bank Transfer',
    },
    transactionReference: {
      type: String,
      default: '',
      trim: true,
    },
    paymentStatus: {
      type: String,
      enum: ['Pending', 'Processing', 'Paid', 'Failed'],
      default: 'Paid',
    },
    disbursedAt: {
      type: Date,
      default: Date.now,
    },
    disbursedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    remarks: {
      type: String,
      default: '',
    },
    attendanceRemarks: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

// Composite index to prevent double payment for same user + month + year
PayrollDisbursementSchema.index({ userId: 1, month: 1, year: 1 }, { unique: true });

export default mongoose.model('PayrollDisbursement', PayrollDisbursementSchema);
