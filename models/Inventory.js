import mongoose from 'mongoose';

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
