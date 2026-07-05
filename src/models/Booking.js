const mongoose = require('mongoose');

const BookingSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  age: {
    type: Number,
    required: true
  },
  address: {
    type: String,
    required: true
  },
  education: {
    type: String,
    required: true
  },
  currentStatus: {
    type: String,
    required: true
  },
  skills: {
    type: String,
    default: ''
  },
  services: {
    type: [String],
    required: true
  },
  careerDetails: {
    industry: { type: String, default: '' },
    position: { type: String, default: '' }
  },
  migrationDetails: {
    preferredCountry: { type: String, default: '' },
    passportStatus: { type: String, default: '' },
    overseasExperience: { type: String, default: '' }
  },
  placementDetails: {
    preferredIndustry: { type: String, default: '' },
    cvPath: { type: String, default: '' }
  },
  notes: {
    type: String,
    default: ''
  },
  amount: {
    type: Number,
    required: true
  },
  paymentId: {
    type: String,
    default: ''
  },
  paymentStatus: {
    type: String,
    enum: ['Pending', 'Paid'],
    default: 'Pending'
  },
  status: {
    type: String,
    enum: ['New', 'Processing', 'Completed'],
    default: 'New'
  },
  counselorNotes: {
    type: String,
    default: ''
  },
  meetingDetails: {
    link: { type: String, default: '' },
    dateTime: { type: Date, default: null }
  },
  postMeetingDetails: {
    notes: { type: String, default: '' },
    documentPath: { type: String, default: '' },
    documentPaths: { type: [String], default: [] }
  }
}, { timestamps: true });

module.exports = mongoose.model('Booking', BookingSchema);
