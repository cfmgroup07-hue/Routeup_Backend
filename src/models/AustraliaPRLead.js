const mongoose = require('mongoose');

const AustraliaPRLeadSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    existingExperience: {
      type: String,
      default: '',
    },
    occupation: {
      type: String,
      required: true,
      trim: true,
    },
    anzsco: {
      type: String,
      default: '',
    },
    assessingBody: {
      type: String,
      default: '',
    },
    source: {
      type: String,
      enum: ['document-upload', 'eligibility-check'],
      required: true,
    },
    origin: {
      type: String,
      enum: ['offshore', 'onshore', ''],
      default: '',
    },
    country: {
      type: String,
      default: '',
    },
    state: {
      type: String,
      default: '',
    },
    uploadedDocuments: [
      {
        title: { type: String, required: true },
        fileName: { type: String, default: '' },
        filePath: { type: String, default: '' },
      },
    ],
    status: {
      type: String,
      enum: ['New', 'Contacted', 'Converted', 'Closed'],
      default: 'New',
    },
    adminNotes: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AustraliaPRLead', AustraliaPRLeadSchema);
