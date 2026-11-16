import mongoose from 'mongoose';
import { createDynamicModelProxy } from "../utils/tenantContext.js";

const LibrarySchema = new mongoose.Schema({
  bookId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Book',
    required: true
  },
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  issueDate: {
    type: Date,
    required: true,
    default: Date.now
  },
  dueDate: {
    type: Date,
    required: true
  },
  returnDate: {
    type: Date
  },
  fine: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

const Library = mongoose.models.Library || mongoose.model('Library', LibrarySchema);
export default createDynamicModelProxy('Library', Library);
