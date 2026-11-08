import mongoose from 'mongoose';

const PurchaseItemSchema = new mongoose.Schema({
  itemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Inventory',
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  sku: {
    type: String,
    required: true,
  },
  category: {
    type: String,
    default: 'General',
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
  },
  unit: {
    type: String,
    default: 'pcs',
  },
  unitCost: {
    type: Number,
    required: true,
    min: 0,
  },
  totalCost: {
    type: Number,
    required: true,
    min: 0,
  },
});

const InventoryPurchaseSchema = new mongoose.Schema(
  {
    billNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    poNumber: {
      type: String,
      trim: true,
      default: '',
    },
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
      required: true,
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AcademicSession',
    },
    sessionName: {
      type: String,
      default: '',
    },
    billDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    receivedDate: {
      type: Date,
      default: Date.now,
    },
    items: [PurchaseItemSchema],
    subtotal: {
      type: Number,
      required: true,
      default: 0,
    },
    taxAmount: {
      type: Number,
      default: 0,
    },
    discountAmount: {
      type: Number,
      default: 0,
    },
    grandTotal: {
      type: Number,
      required: true,
      default: 0,
    },
    paymentType: {
      type: String,
      enum: ['Cash', 'Bank Transfer', 'Cheque', 'UPI', 'Credit / On Account'],
      default: 'Bank Transfer',
    },
    paymentStatus: {
      type: String,
      enum: ['Paid', 'Partial', 'Unpaid'],
      default: 'Paid',
    },
    amountPaid: {
      type: Number,
      default: 0,
    },
    balanceDue: {
      type: Number,
      default: 0,
    },
    transactionReference: {
      type: String,
      trim: true,
      default: '',
    },
    budgetDeducted: {
      budgetAllocationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'BudgetAllocation',
      },
      category: {
        type: String,
        default: 'schoolRequirements',
      },
      amount: {
        type: Number,
        default: 0,
      },
      previousSpent: Number,
      newSpent: Number,
    },
    receivedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    receivedByName: {
      type: String,
      default: 'Admin',
    },
    invoiceAttachmentUrl: {
      type: String,
      default: '',
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

InventoryPurchaseSchema.pre('save', function (next) {
  this.balanceDue = Math.max(0, (this.grandTotal || 0) - (this.amountPaid || 0));
  if (this.balanceDue === 0) {
    this.paymentStatus = 'Paid';
  } else if (this.amountPaid > 0) {
    this.paymentStatus = 'Partial';
  } else {
    this.paymentStatus = 'Unpaid';
  }
  next();
});

export default mongoose.model('InventoryPurchase', InventoryPurchaseSchema);

