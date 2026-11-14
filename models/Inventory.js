import mongoose from 'mongoose';

const InventoryItemLineSchema = new mongoose.Schema(
  {
    catalogId: { type: String, default: '' },
    name: { type: String, required: true, trim: true },
    sku: { type: String, required: true, trim: true, uppercase: true },
    description: { type: String, default: '', trim: true },
    imageUrl: { type: String, default: '', trim: true },
    category: { type: String, default: 'General' },
    subcategory: { type: String, default: '', trim: true },
    quantity: { type: Number, required: true, default: 1, min: 0 },
    unit: { type: String, default: 'pcs', trim: true },
    unitCost: { type: Number, default: 0, min: 0 },
    price: { type: Number, default: 0, min: 0 },
    gstRate: { type: Number, default: 12, min: 0 },
    gstAmount: { type: Number, default: 0, min: 0 },
    totalCostWithTax: { type: Number, default: 0, min: 0 },
    minStockLevel: { type: Number, default: 5 },
    maxStockLevel: { type: Number, default: 500 },
    reorderQuantity: { type: Number, default: 20 },
    location: { type: String, default: 'Main Store' },
  },
  { _id: true }
);

const InventorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    sku: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    imageUrl: {
      type: String,
      trim: true,
      default: '',
    },
    category: {
      type: String,
      required: true,
      enum: [
        'Stationery',
        'Lab Equipment',
        'Computers & IT',
        'Sports Items',
        'Uniforms & Badges',
        'Medical & First Aid',
        'Furniture',
        'Books & Publications',
        'Maintenance & Facilities',
        'General',
        // Backward-compatible values
        'Books',
        'Computers',
        'Uniforms',
        'Electronics',
      ],
      default: 'General',
    },
    subcategory: {
      type: String,
      trim: true,
      default: '',
    },
    items: [InventoryItemLineSchema],
    itemCount: {
      type: Number,
      default: 1,
    },
    totalQuantity: {
      type: Number,
      default: 0,
    },
    subtotal: {
      type: Number,
      default: 0,
    },
    totalGst: {
      type: Number,
      default: 0,
    },
    grandTotal: {
      type: Number,
      default: 0,
    },
    quantity: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    unit: {
      type: String,
      required: true,
      default: 'pcs',
      trim: true,
    },
    minStockLevel: {
      type: Number,
      required: true,
      default: 5,
      min: 0,
    },
    maxStockLevel: {
      type: Number,
      default: 1000,
    },
    reorderQuantity: {
      type: Number,
      default: 20,
    },
    price: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    unitCost: {
      type: Number,
      default: 0,
      min: 0,
    },
    gstRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    gstAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    shippingCharges: {
      type: Number,
      default: 0,
      min: 0,
    },
    otherCharges: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalCostWithTax: {
      type: Number,
      default: 0,
      min: 0,
    },
    expectedDeliveryDate: {
      type: Date,
    },
    actualPurchaseDate: {
      type: Date,
    },
    invoiceAttachment: {
      filename: { type: String, default: '' },
      originalName: { type: String, default: '' },
      url: { type: String, default: '' },
      mimeType: { type: String, default: '' },
      size: { type: Number, default: 0 },
    },
    additionalAttachments: [
      {
        filename: { type: String, default: '' },
        originalName: { type: String, default: '' },
        url: { type: String, default: '' },
        mimeType: { type: String, default: '' },
        size: { type: Number, default: 0 },
      },
    ],
    location: {
      type: String,
      trim: true,
      default: 'Main Store',
    },
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
    },
    status: {
      type: String,
      enum: ['in-stock', 'low-stock', 'out-of-stock', 'discontinued'],
      default: 'in-stock',
    },
  },
  {
    timestamps: true,
  }
);

// Dynamically maintain status based on quantity and minStockLevel
InventorySchema.pre('save', function (next) {
  if (this.unitCost === 0 && this.price > 0) {
    this.unitCost = this.price;
  }
  if (this.price === 0 && this.unitCost > 0) {
    this.price = this.unitCost;
  }

  if (this.quantity <= 0) {
    this.status = 'out-of-stock';
  } else if (this.quantity <= this.minStockLevel) {
    this.status = 'low-stock';
  } else {
    this.status = 'in-stock';
  }
  next();
});

export default mongoose.model('Inventory', InventorySchema);
