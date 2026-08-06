import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  employeeId: {
    type: String,
    trim: true,
    uppercase: true,
    sparse: true,
    unique: true
  },
  admissionNumber: {
    type: String,
    trim: true,
    uppercase: true,
    sparse: true,
    unique: true
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['super-admin', 'school-admin', 'principal', 'teacher', 'head-teacher', 'hod', 'coordinator', 'accountant', 'librarian', 'student', 'parent'],
    default: 'student'
  },
  permissions: [{
    type: String,
    trim: true
  }],
  name: {
    type: String,
    required: true
  },
  profileId: {
    type: String // References Student/Teacher ID
  },
  isActive: {
    type: Boolean,
    default: true
  },
  forcePasswordChange: {
    type: Boolean,
    default: false
  },
  accountExpiryDate: {
    type: Date
  },
  loginRestriction: {
    type: String,
    enum: ['none', 'school-network', 'office-hours'],
    default: 'none'
  },
  twoFactorEnabled: {
    type: Boolean,
    default: false
  },
  refreshToken: {
    type: String
  },
  tempPassword: {
    type: String
  },
  lastLogin: {
    type: Date
  },
  loginHistory: [{
    ip: String,
    userAgent: String,
    timestamp: { type: Date, default: Date.now }
  }]
}, {
  timestamps: true
});

UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();

  // Always store tempPassword as the plain text representation
  this.tempPassword = this.password;

  // Do not hash password for student or teacher accounts if plain text storage is preferred
  if (this.role === 'student' || this.role === 'teacher' || this.isPlainTextPassword) {
    return next();
  }

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

UserSchema.methods.comparePassword = async function (enteredPassword) {
  if (this.password && (this.password.startsWith("$2a$") || this.password.startsWith("$2b$"))) {
    return await bcrypt.compare(enteredPassword, this.password);
  }
  return enteredPassword === this.password;
};

export default mongoose.model('User', UserSchema);
