const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Admin = require('../models/Admin');
const ActivityLog = require('../models/ActivityLog');
const { logAdminActivity } = require('../utils/activityLogger');
const { protect } = require('../middleware/authMiddleware');

const avatarDir = path.join(__dirname, '../../uploads/admin-avatars');
if (!fs.existsSync(avatarDir)) {
  fs.mkdirSync(avatarDir, { recursive: true });
}

const avatarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, avatarDir),
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `avatar-${uniqueSuffix}${path.extname(file.originalname).toLowerCase()}`);
  },
});

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only JPG, PNG, WEBP, or GIF images are allowed'));
  },
});

const deleteAvatarIfExists = (filePath) => {
  if (!filePath) return;
  const fullPath = path.join(__dirname, '../..', filePath.replace(/^\//, ''));
  if (fs.existsSync(fullPath)) {
    try {
      fs.unlinkSync(fullPath);
    } catch {
      /* ignore */
    }
  }
};

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });

const toAdminPayload = (admin, token) => ({
  _id: admin._id,
  name: admin.name || 'Admin',
  email: admin.email,
  role: admin.role || 'admin',
  avatar: admin.avatar || '',
  ...(token ? { token } : {}),
});

// @desc    Auth admin & get token
// @route   POST /api/auth/login
// @access  Public
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    if (!email || !password) {
      return res.status(400).json({ message: 'Please provide email and password' });
    }

    const admin = await Admin.findOne({ email: String(email).trim().toLowerCase() });

    if (admin && (await admin.matchPassword(password))) {
      const token = signToken(admin._id);
      await logAdminActivity(admin, 'LOGIN', 'Logged into the admin panel');
      return res.json(toAdminPayload(admin, token));
    }

    return res.status(401).json({ message: 'Invalid email or password' });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// @desc    Get current admin profile
// @route   GET /api/auth/me
// @access  Private
router.get('/me', protect, async (req, res) => {
  try {
    if (!req.admin) {
      return res.status(401).json({ message: 'Not authorized' });
    }
    return res.json(toAdminPayload(req.admin));
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// @desc    Update admin profile (name / email / avatar)
// @route   PUT /api/auth/profile
// @access  Private
router.put('/profile', protect, (req, res) => {
  avatarUpload.single('avatar')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ message: err.message || 'Avatar upload failed' });
    }

    try {
      const admin = await Admin.findById(req.admin._id);
      if (!admin) {
        return res.status(404).json({ message: 'Admin not found' });
      }

      const { name, email, removeAvatar } = req.body;
      if (name !== undefined) {
        const trimmed = String(name).trim();
        if (!trimmed) {
          return res.status(400).json({ message: 'Name cannot be empty' });
        }
        admin.name = trimmed;
      }

      if (email !== undefined) {
        const nextEmail = String(email).trim().toLowerCase();
        if (!nextEmail || !nextEmail.includes('@')) {
          return res.status(400).json({ message: 'Please provide a valid email' });
        }
        const taken = await Admin.findOne({ email: nextEmail, _id: { $ne: admin._id } });
        if (taken) {
          return res.status(400).json({ message: 'This email is already in use' });
        }
        admin.email = nextEmail;
      }

      if (req.file) {
        deleteAvatarIfExists(admin.avatar);
        admin.avatar = `/uploads/admin-avatars/${req.file.filename}`;
      } else if (removeAvatar === 'true' || removeAvatar === true) {
        deleteAvatarIfExists(admin.avatar);
        admin.avatar = '';
      }

      await admin.save();
      await logAdminActivity(
        admin,
        'UPDATE_PROFILE',
        `Updated profile details (Name: ${admin.name}, Email: ${admin.email})`
      );
      return res.json({
        message: 'Profile updated successfully',
        ...toAdminPayload(admin),
      });
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  });
});

// @desc    Change admin password
// @route   PUT /api/auth/password
// @access  Private
router.put('/password', protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current and new password are required' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }

    const admin = await Admin.findById(req.admin._id);
    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    const ok = await admin.matchPassword(currentPassword);
    if (!ok) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }

    admin.password = newPassword;
    await admin.save();
    await logAdminActivity(admin, 'CHANGE_PASSWORD', 'Changed password');

    return res.json({ message: 'Password changed successfully' });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// @desc    Get admin activity logs (Super Admin only)
// @route   GET /api/auth/activities
// @access  Private (Super Admin)
router.get('/activities', protect, async (req, res) => {
  try {
    if (req.admin.role !== 'superadmin') {
      return res.status(403).json({ message: 'Access denied: Super Admin role required' });
    }

    const logs = await ActivityLog.find()
      .populate('admin', 'name email role avatar')
      .sort({ createdAt: -1 });

    const filteredLogs = logs.filter(log => !log.admin || log.admin.role !== 'superadmin');

    return res.json(filteredLogs);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

module.exports = router;
