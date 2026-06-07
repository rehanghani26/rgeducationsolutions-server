import mongoose from 'mongoose';

const ExpenseSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  category: {
    type: String,
    required: true,
    enum: ['Utilities', 'Payroll', 'Maintenance', 'Academic Supplies', 'Transport', 'Food Services', 'Others']
  },
  date: {
    type: Date,
    required: true,
    default: Date.now
  },
  refInvoice: {
    type: String
  }
}, {
  timestamps: true
});

export default mongoose.model('Expense', ExpenseSchema);
