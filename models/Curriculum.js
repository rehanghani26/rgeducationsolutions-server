import mongoose from 'mongoose';

const UnitSchema = new mongoose.Schema({
  id: { type: Number },
  title: { type: String, required: true },
  status: { type: String, enum: ['completed', 'in-progress', 'upcoming'], default: 'upcoming' },
  duration: { type: String, default: '2 weeks' },
});

const MaterialSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, default: 'PDF' },
  size: { type: String, default: '2.5 MB' },
  url: { type: String, default: '' },
  date: { type: String, default: () => new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) },
});

const CurriculumSchema = new mongoose.Schema(
  {
    className: {
      type: String,
      required: true,
      trim: true,
      default: 'Class 10',
    },
    sectionName: {
      type: String,
      trim: true,
      default: 'All Sections',
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    type: {
      type: String,
      enum: ['theory', 'practical'],
      default: 'theory',
    },
    credits: {
      type: Number,
      default: 4,
    },
    teacher: {
      type: String,
      default: 'Unassigned',
      trim: true,
    },
    teacherRole: {
      type: String,
      default: 'Subject Lecturer',
      trim: true,
    },
    room: {
      type: String,
      default: 'Room 101',
      trim: true,
    },
    schedule: {
      type: String,
      default: 'Mon, Wed, Fri (08:00 AM)',
      trim: true,
    },
    progress: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
    currentChapter: {
      type: String,
      default: '',
      trim: true,
    },
    assignedBy: {
      type: String,
      default: 'Administration',
    },
    assignedByRole: {
      type: String,
      default: 'admin',
    },
    units: [UnitSchema],
    materials: [MaterialSchema],
  },
  {
    timestamps: true,
  }
);

CurriculumSchema.index({ className: 1, sectionName: 1, code: 1 });

export default mongoose.model('Curriculum', CurriculumSchema);
