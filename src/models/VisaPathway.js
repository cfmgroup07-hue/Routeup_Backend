const mongoose = require('mongoose');

const VisaPathwaySchema = new mongoose.Schema({
  countryName: {
    type: String,
    required: true,
    trim: true
  },
  countryFlag: {
    type: String,
    required: true,
    trim: true
  },
  visaTypes: {
    type: [String],
    required: true
  },
  description: {
    type: String,
    required: true
  },
  docBadgeText: {
    type: String,
    default: 'Detailed visa document provided'
  }
}, { timestamps: true });

module.exports = mongoose.model('VisaPathway', VisaPathwaySchema);
