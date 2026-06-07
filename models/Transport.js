import mongoose from 'mongoose';

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

export default mongoose.model('Transport', TransportSchema);
