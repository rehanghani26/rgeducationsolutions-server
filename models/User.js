import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import tenantPlugin from '../utils/tenantPlugin.js';

const UserSchema = new mongoose.Schema({
  schoolId: {
    type: String,
    required: [true, 'schoolId is mandatory for school user separation'],
    index: true,
    uppercase: true,
    trim: true,
  },
  username: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  employeeId: {
    type: String,
    trim: true,
    uppercase: true,
  },
  admissionNumber: {
    type: String,
    trim: true,
    uppercase: true,
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: [
      'super-admin',
      'school-admin',
      'director',
      'principal',
      'teacher',
      'head-teacher',
      'hod',
      'coordinator',
      'accountant',
      'librarian',
      'peon'
    ],
    default: 'teacher'
  },
  // Deprecated: Permissions are now governed 100% role-wise via RolePermission model
  permissions: {
    type: [String],
    default: [],
  },
  name: {
    type: String,
    required: true
  },
  avatar: {
    type: String,
    default: '',
    trim: true
  },
  photo: {
    type: String,
    default: '',
    trim: true
  },
  imagesRef: {
    id: { type: String, default: '' },
    img: { type: String, default: '' },
  },
  phone: {
    type: String,
    trim: true
  },
  alternatePhone: {
    type: String,
    trim: true
  },
  gender: {
    type: String,
    enum: ['Male', 'Female', 'Other', ''],
    default: ''
  },
  dob: {
    type: Date
  },
  address: {
    type: String,
    trim: true
  },
  qualification: {
    type: String,
    trim: true
  },
  designation: {
    type: String,
    trim: true
  },
  department: {
    type: String,
    trim: true
  },
  joiningDate: {
    type: Date,
    default: Date.now
  },
  salary: {
    type: Number,
    default: 0
  },
  isClassTeacher: {
    type: Boolean,
    default: false
  },
  classTeacherOf: {
    type: String, // e.g. "Class 10 - Section A"
    trim: true
  },
  classesAssigned: [{
    type: String,
    trim: true
  }],
  sectionsAssigned: [{
    type: String,
    trim: true
  }],
  subjectsAssigned: [{
    type: String,
    trim: true
  }],
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
  }],
  failedLoginAttempts: {
    type: Number,
    default: 0
  },
  lockUntil: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();

  // Always store tempPassword as the plain text representation
  this.tempPassword = this.password;

  // Do not hash password for teacher accounts if plain text storage is preferred
  if (this.role === 'teacher' || this.isPlainTextPassword) {
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
  if (!enteredPassword || typeof enteredPassword !== 'string') return false;
  if (this.password && (this.password.startsWith("$2a$") || this.password.startsWith("$2b$"))) {
    try {
      return await bcrypt.compare(enteredPassword, this.password);
    } catch (_e) {
      return false;
    }
  }
  if (this.password && enteredPassword === this.password) {
    return true;
  }
  if (this.tempPassword && enteredPassword === this.tempPassword) {
    return true;
  }
  return false;
};

// Multi-tenant scoped compound indexes
UserSchema.index({ schoolId: 1, email: 1 }, { unique: true });
UserSchema.index({ schoolId: 1, username: 1 }, { unique: true });
UserSchema.index(
  { schoolId: 1, employeeId: 1 },
  {
    unique: true,
    partialFilterExpression: { employeeId: { $type: 'string' } },
  }
);

UserSchema.plugin(tenantPlugin);

export default mongoose.model('User', UserSchema);
