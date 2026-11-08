import mongoose from 'mongoose';

const InventoryTransactionSchema = new mongoose.Schema(
  {
    transactionNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    type: {
      type: String,
      enum: [
        'STOCK_IN_PURCHASE',
        'STOCK_OUT_CLASS',
        'STOCK_OUT_STUDENT',
        'STOCK_OUT_TEACHER',
        'STOCK_ADJUST_ADD',
        'STOCK_ADJUST_REMOVE',
        'RETURN_TO_VENDOR',
        'RETURN_FROM_CLASS',
      ],
      required: true,
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Inventory',
      required: true,
    },
    itemName: {
      type: String,
      required: true,
    },
    sku: {
      type: String,
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
    },
    unit: {
      type: String,
      default: 'pcs',
    },
    unitPrice: {
      type: Number,
      default: 0,
    },
    totalValue: {
      type: Number,
      default: 0,
    },
    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    referenceDocNumber: {
      type: String,
      default: '',
    },
    partyName: {
      type: String,
      default: '',
    },
    balanceAfter: {
      type: Number,
      required: true,
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    performedByName: {
      type: String,
      default: 'Admin',
    },
    reason: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model('InventoryTransaction', InventoryTransactionSchema);

