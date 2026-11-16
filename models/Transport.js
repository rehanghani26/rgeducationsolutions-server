import mongoose from 'mongoose';
import { createDynamicModelProxy } from "../utils/tenantContext.js";

const TransportSchema = new mongoose.Schema({
  routeName: {
    type: String,
    required: true,
    unique: true
  },
  busNumber: {
    type: String,
    required: true,
    unique: true
  },
  driverName: {
    type: String,
    required: true
  },
  driverContact: {
    type: String,
    required: true
  },
  stops: [{
    type: String
  }],
  fare: {
    type: Number,
    required: true
  },
  assignedStudents: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student'
  }]
}, {
  timestamps: true
});

const Transport = mongoose.models.Transport || mongoose.model('Transport', TransportSchema);
export default createDynamicModelProxy('Transport', Transport);
