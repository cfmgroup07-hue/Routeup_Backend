const mongoose = require('mongoose');

const StudyAbroadLeadSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    applyingCourse: { type: String, required: true, trim: true },
    targetUniversity: { type: String, default: '' },
    country: { type: String, required: true, trim: true },
    uploadedDocuments: [
      {
        title: { type: String, required: true },
        fileName: { type: String, default: '' },
        filePath: { type: String, default: '' },
        needsReupload: { type: Boolean, default: false },
        reuploadNote: { type: String, default: '' },
      },
    ],
    totalRequired: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['New', 'Contacted', 'Converted', 'Closed'],
      default: 'New',
    },
    adminNotes: { type: String, default: '' },
    reuploadToken: { type: String, default: '', index: true },
    reuploadExpiresAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model('StudyAbroadLead', StudyAbroadLeadSchema);
