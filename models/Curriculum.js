import mongoose from 'mongoose';
import academicRecordPlugin from '../utils/academicRecordPlugin.js';
import { createDynamicModelProxy } from '../utils/tenantContext.js';

const ChapterProgressSchema = new mongoose.Schema({
  chapterId: { type: String, required: true },
  status: { type: String, enum: ['upcoming', 'in-progress', 'completed'], required: true },
  plannedDate: String,
}, { _id: false });

const ResourceSchema = new mongoose.Schema({
  id: { type: String, required: true },
  title: { type: String, required: true },
  url: { type: String, required: true },
  chapterId: String,
  shared: Boolean,
}, { _id: false });

const CurriculumSchema = new mongoose.Schema({
  classId: String,
  className: String,
  sectionName: String,
  classRoomId: String,
  subjectId: String,
  teacherId: String,
  revision: { type: Number, default: 0 },
  chapterProgress: { type: [ChapterProgressSchema], default: undefined },
  resources: { type: [ResourceSchema], default: undefined },
  changeRequest: {
    note: String,
    requestedBy: String,
    requestedAt: Date,
    resolvedAt: Date,
  },
}, { timestamps: true });

CurriculumSchema.index({ schoolId: 1, sessionId: 1, classRoomId: 1, subjectId: 1 }, {
  unique: true,
  partialFilterExpression: { classRoomId: { $type: 'string' }, subjectId: { $type: 'string' } },
});
CurriculumSchema.plugin(academicRecordPlugin, { collection: 'curriculums' });

const Curriculum = mongoose.models.Curriculum || mongoose.model('Curriculum', CurriculumSchema);
export default createDynamicModelProxy('Curriculum', Curriculum);
