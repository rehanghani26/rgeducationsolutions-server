import mongoose from 'mongoose';

const ClassSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  code: {
    type: String,
    required: true,
    unique: true
  },
  room: {
    type: String
  },
  capacity: {
    type: Number,
    default: 40
  }
}, {
  timestamps: true
});

export default mongoose.model('Class', ClassSchema);
