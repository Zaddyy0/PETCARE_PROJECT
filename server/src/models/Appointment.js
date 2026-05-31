import mongoose from 'mongoose';

const appointmentSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    pet: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Pet',
      required: true
    },
    reason: {
      type: String,
      required: true,
      trim: true
    },
    datetime: {
      type: Date,
      required: true
    },
    status: {
      type: String,
      enum: ['scheduled', 'ongoing', 'completed'],
      default: 'scheduled'
    }
  },
  {
    timestamps: true
  }
);

export default mongoose.model('Appointment', appointmentSchema);
