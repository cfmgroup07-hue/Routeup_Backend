const ActivityLog = require('../models/ActivityLog');

const logAdminActivity = async (admin, action, details, metadata = {}) => {
  try {
    if (!admin) {
      console.warn('Cannot log admin activity: no admin object provided');
      return;
    }
    
    // Skip logging for super admin actions
    if (admin.role === 'superadmin') {
      return;
    }
    
    // Create activity log
    await ActivityLog.create({
      admin: admin._id,
      adminEmail: admin.email,
      adminName: admin.name || 'Admin',
      action,
      details,
      metadata
    });
  } catch (error) {
    console.error('Failed to log admin activity:', error);
  }
};

module.exports = { logAdminActivity };
