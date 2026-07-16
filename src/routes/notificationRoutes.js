const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const { protect } = require('../middleware/authMiddleware');

// @desc    Get all notifications
// @route   GET /api/notifications
// @access  Private (Admin)
router.get('/', protect, async (req, res) => {
  try {
    const notifications = await Notification.find({}).sort({ createdAt: -1 });
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Mark one or all notifications as read
// @route   PUT /api/notifications/mark-read
// @access  Private (Admin)
router.put('/mark-read', protect, async (req, res) => {
  const { id } = req.body;
  try {
    if (id) {
      const notification = await Notification.findById(id);
      if (!notification) {
        return res.status(404).json({ message: 'Notification not found' });
      }
      notification.isRead = true;
      await notification.save();
    } else {
      // Mark all as read
      await Notification.updateMany({ isRead: false }, { isRead: true });
    }
    res.json({ message: 'Notifications marked as read' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Delete all notifications
// @route   DELETE /api/notifications
// @access  Private (Admin)
router.delete('/', protect, async (req, res) => {
  try {
    await Notification.deleteMany({});
    res.json({ message: 'All notifications cleared' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
