import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { createDynamicModelProxy } from "../utils/tenantContext.js";

const VendorSchema = new mongoose.Schema(
  {
    vendorCode: {
      type: String,
      unique: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    category: {
      type: String,
      enum: [
        'Stationery',
        'Lab Equipment',
        'IT Hardware',
        'Sports',
        'Uniforms',
        'Medical',
        'Furniture',
        'General',
      ],
      default: 'General',
    },
    contactPerson: {
      type: String,
      trim: true,
      default: '',
    },
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    altPhone: {
      type: String,
      trim: true,
      default: '',
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
    },
    billingEmail: { type: String, trim: true, lowercase: true, default: '' },
    website: { type: String, trim: true, default: '' },
    leadTimeDays: { type: Number, min: 0, max: 365 },
    address: {
      type: String,
      trim: true,
      default: '',
    },
    city: {
      type: String,
      trim: true,
      default: '',
    },
    state: {
      type: String,
      trim: true,
      default: '',
    },
    pincode: {
      type: String,
      trim: true,
      default: '',
    },
    gstin: {
      type: String,
      trim: true,
      default: '',
    },
    pan: {
      type: String,
      trim: true,
      default: '',
    },
    bankDetails: {
      accountHolderName: { type: String, trim: true, default: '' },
      bankName: { type: String, trim: true, default: '' },
      accountNumber: { type: String, trim: true, default: '' },
      ifscCode: { type: String, trim: true, default: '' },
      branchName: { type: String, trim: true, default: '' },
      upiId: { type: String, trim: true, default: '' },
    },
    paymentTerms: {
      type: String,
      enum: ['Immediate', 'Net 15', 'Net 30', 'Net 60', 'Advance'],
      default: 'Net 30',
    },
    totalBilled: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalPaid: {
      type: Number,
      default: 0,
      min: 0,
    },
    outstandingBalance: {
      type: Number,
      default: 0,
    },
    payments: [{
      requestId: String,
      requestHash: String,
      amount: { type: Number, required: true },
      paymentDate: { type: Date, required: true },
      paymentType: { type: String, required: true },
      transactionReference: String,
      notes: String,
      appliedBills: [{ billId: mongoose.Schema.Types.ObjectId, billNumber: String, amount: Number }],
      recordedByName: String,
    }],
    rating: {
      type: Number,
      default: 5,
      min: 1,
      max: 5,
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'blacklisted'],
      default: 'active',
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

// Auto-generate vendorCode if missing
VendorSchema.pre('save', function (next) {
  if (!this.vendorCode) {
    this.vendorCode = `VND-${randomUUID().slice(0, 12).toUpperCase()}`;
  }
  this.outstandingBalance = Math.round(((this.totalBilled || 0) - (this.totalPaid || 0)) * 100) / 100;
  next();
});

const Vendor = mongoose.models.Vendor || mongoose.model('Vendor', VendorSchema);
export default createDynamicModelProxy('Vendor', Vendor);
