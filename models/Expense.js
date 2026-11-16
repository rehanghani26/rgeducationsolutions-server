import mongoose from 'mongoose';
import { createDynamicModelProxy } from "../utils/tenantContext.js";

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

const Expense = mongoose.models.Expense || mongoose.model('Expense', ExpenseSchema);
export default createDynamicModelProxy('Expense', Expense);
