import mongoose from 'mongoose';

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
VendorSchema.pre('save', async function (next) {
  if (!this.vendorCode) {
    const count = await mongoose.model('Vendor').countDocuments();
    this.vendorCode = `VND-${String(count + 1).padStart(3, '0')}`;
  }
  this.outstandingBalance = (this.totalBilled || 0) - (this.totalPaid || 0);
  next();
});

export default mongoose.model('Vendor', VendorSchema);
