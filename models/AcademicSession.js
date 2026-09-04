import mongoose from 'mongoose';

const AcademicSessionSchema = new mongoose.Schema(
  {
    sessionName: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    }, // e.g. "2025-2026", "2026-2027"
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    isCurrent: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ['upcoming', 'active', 'completed'],
      default: 'upcoming',
    },
    notes: {
      type: String,
      default: '',
    },
    createdBy: {
      type: String,
      default: 'admin',
    },
  },
  { timestamps: true }
);

export default mongoose.model('AcademicSession', AcademicSessionSchema);
