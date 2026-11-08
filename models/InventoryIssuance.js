import mongoose from 'mongoose';

const IssuanceItemSchema = new mongoose.Schema({
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
  unitPrice: {
    type: Number,
    default: 0,
  },
  totalAmount: {
    type: Number,
    default: 0,
  },
  returnable: {
    type: Boolean,
    default: false,
  },
  returnedQuantity: {
    type: Number,
    default: 0,
  },
});

const InventoryIssuanceSchema = new mongoose.Schema(
  {
    issuanceNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    recipientType: {
      type: String,
      enum: ['class', 'student', 'teacher', 'department'],
      required: true,
      default: 'class',
    },
    classId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ClassRoom',
    },
    className: {
      type: String,
      default: '',
      trim: true,
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
    },
    studentName: {
      type: String,
      default: '',
      trim: true,
    },
    studentRollNo: {
      type: String,
      default: '',
      trim: true,
    },
    teacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Teacher',
    },
    teacherName: {
      type: String,
      default: '',
      trim: true,
    },
    department: {
      type: String,
      default: '',
      trim: true,
    },
    issuedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    issuedByName: {
      type: String,
      default: 'Store In-Charge',
    },
    issuanceDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    items: [IssuanceItemSchema],
    totalAmount: {
      type: Number,
      required: true,
      default: 0,
    },
    billingType: {
      type: String,
      enum: ['complimentary', 'billable'],
      default: 'complimentary',
    },
    purpose: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: ['issued', 'partially_returned', 'returned', 'cancelled'],
      default: 'issued',
    },
    acknowledgedBy: {
      type: String,
      trim: true,
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

export default mongoose.model('InventoryIssuance', InventoryIssuanceSchema);

