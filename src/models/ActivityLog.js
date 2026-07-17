const mongoose = require('mongoose');

const ActivityLogSchema = new mongoose.Schema({
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true
  },
  adminEmail: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  adminName: {
    type: String,
    default: 'Admin',
    trim: true
  },
  action: {
    type: String,
    required: true,
    trim: true
  },
  details: {
    type: String,
    required: true,
    trim: true
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, { timestamps: true });

module.exports = mongoose.model('ActivityLog', ActivityLogSchema);
