import mongoose from 'mongoose';

const BudgetRevisionSchema = new mongoose.Schema({
  revisedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  revisedByName: {
    type: String,
    default: 'Admin',
  },
  category: {
    type: String,
    enum: ['salary', 'schoolRequirements', 'operationalBuffer', 'total'],
    required: true,
  },
  previousAmount: {
    type: Number,
    required: true,
  },
  newAmount: {
    type: Number,
    required: true,
  },
  deltaAmount: {
    type: Number,
    required: true,
  },
  reason: {
    type: String,
    required: true,
    trim: true,
  },
  revisedAt: {
    type: Date,
    default: Date.now,
  },
});

const BudgetAllocationSchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AcademicSession',
      required: true,
      unique: true,
    },
    sessionName: {
      type: String,
      required: true,
      trim: true,
    },
    // Overall Total Budget allocated for this session
    totalBudget: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    // 1. Staff Salary & Faculty Payroll
    salaryBudget: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    salarySpent: {
      type: Number,
      default: 0,
      min: 0,
    },
    // 2. School Requirements, Labs, Stationery, Repairs
    schoolRequirementsBudget: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    schoolRequirementsSpent: {
      type: Number,
      default: 0,
      min: 0,
    },
    // 3. Operational Buffer, Contingency, Events
    operationalBufferBudget: {
      type: Number,
      default: 0,
      min: 0,
    },
    operationalBufferSpent: {
      type: Number,
      default: 0,
      min: 0,
    },
    notes: {
      type: String,
      default: '',
      trim: true,
    },
    status: {
      type: String,
      enum: ['draft', 'active', 'revised', 'closed'],
      default: 'active',
    },
    revisionLogs: [BudgetRevisionSchema],
  },
  {
    timestamps: true,
  }
);

export default mongoose.model('BudgetAllocation', BudgetAllocationSchema);

