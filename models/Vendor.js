import mongoose from 'mongoose';

const VendorSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  contactPerson: {
    type: String
  },
  phone: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true
  },
  address: {
    type: String
  }
}, {
  timestamps: true
});

export default mongoose.model('Vendor', VendorSchema);
