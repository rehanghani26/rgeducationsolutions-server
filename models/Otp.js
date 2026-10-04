import mongoose from 'mongoose';

const OtpSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true,
  },
  otp: {
    type: String,
    required: true,
  },
  name: {
    type: String,
    trim: true,
    default: '',
  },
  password: {
    type: String,
    default: '',
  },
  purpose: {
    type: String,
    default: 'signup',
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 600, // 10 minutes TTL index automatically cleans expired OTPs
  },
});

export default mongoose.models.Otp || mongoose.model('Otp', OtpSchema);
