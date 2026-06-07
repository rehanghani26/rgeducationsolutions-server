import mongoose from 'mongoose';

const InventorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  sku: {
    type: String,
    required: true,
    unique: true
  },
  category: {
    type: String,
    required: true,
    enum: ['Books', 'Computers', 'Lab Equipment', 'Furniture', 'Sports Items', 'Stationery', 'Uniforms', 'Electronics']
  },
  quantity: {
    type: Number,
    required: true,
    default: 0
  },
  unit: {
    type: String,
    required: true,
    default: 'pcs'
  },
  minStockLevel: {
    type: Number,
    required: true,
    default: 5
  },
  price: {
    type: Number,
    required: true
  },
  vendorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor'
  }
}, {
  timestamps: true
});

export default mongoose.model('Inventory', InventorySchema);
