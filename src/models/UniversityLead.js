const mongoose = require('mongoose');

const UniversityLeadSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    age: { type: String, default: '', trim: true },
    address: { type: String, default: '', trim: true },
    currentStatus: { type: String, default: '', trim: true },
    skills: { type: String, default: '', trim: true },
    preferredCountries: { type: [String], default: [] },
    education: { type: String, default: '', trim: true },
    budget: { type: String, default: '', trim: true },
    timeline: { type: String, default: '', trim: true },
    notes: { type: String, default: '', trim: true },
    source: { type: String, default: 'universities-book-session', trim: true },
    status: {
      type: String,
      enum: ['New', 'Contacted', 'Converted', 'Closed'],
      default: 'New',
    },
    adminNotes: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('UniversityLead', UniversityLeadSchema);
