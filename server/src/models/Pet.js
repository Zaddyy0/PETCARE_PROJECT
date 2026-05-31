import mongoose from 'mongoose';

const petSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    type: {
      type: String,
      required: true,
      trim: true
    },
    breed: {
      type: String,
      trim: true,
      default: ''
    },
    age: {
      type: Number,
      required: true,
      min: 0
    },
    photoUrl: {
      type: String,
      default: ''
    }
  },
  {
    timestamps: true
  }
);

export default mongoose.model('Pet', petSchema);
