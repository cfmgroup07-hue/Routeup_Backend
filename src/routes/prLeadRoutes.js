const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const AustraliaPRLead = require('../models/AustraliaPRLead');
const { protect } = require('../middleware/authMiddleware');
const { sendEmail } = require('../utils/mailer');

const uploadDir = path.join(__dirname, '../../uploads/pr-docs');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const mailUploadDir = path.join(__dirname, '../../uploads/pr-mail');
if (!fs.existsSync(mailUploadDir)) {
  fs.mkdirSync(mailUploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `pr-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.webp'];
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only PDF, DOC, DOCX, and image files are allowed'));
  },
});

const mailStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, mailUploadDir),
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `mail-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const mailUpload = multer({
  storage: mailStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.jpg', '.jpeg', '.png', '.webp', '.txt', '.zip'];
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('File type not allowed for email attachment'));
  },
});

const escapeHtml = (value = '') =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const formatBodyHtml = (value = '') =>
  escapeHtml(value).replace(/\n/g, '<br/>');

// @desc    Submit Australia PR lead (public)
// @route   POST /api/pr-leads
// @access  Public
router.post('/', upload.array('documents', 30), async (req, res) => {
  try {
    const {
      name,
      phone,
      email,
      existingExperience,
      occupation,
      anzsco,
      assessingBody,
      source,
      origin,
      country,
      state,
      documentMeta,
    } = req.body;

    if (!name || !phone || !email || !occupation || !source) {
      return res.status(400).json({
        message: 'Name, phone, email, occupation, and source are required',
      });
    }

    let metaList = [];
    if (documentMeta) {
      try {
        metaList = typeof documentMeta === 'string' ? JSON.parse(documentMeta) : documentMeta;
      } catch {
        metaList = [];
      }
    }

    const files = req.files || [];
    let fileIdx = 0;
    const uploadedDocuments = (Array.isArray(metaList) ? metaList : []).map((item) => {
      const doc = {
        title: item.title || 'Document',
        fileName: item.fileName || '',
        filePath: '',
      };
      if (item.attached && files[fileIdx]) {
        const file = files[fileIdx++];
        doc.fileName = file.originalname;
        doc.filePath = `/uploads/pr-docs/${file.filename}`;
      }
      return doc;
    });

    while (fileIdx < files.length) {
      const file = files[fileIdx++];
      uploadedDocuments.push({
        title: 'Uploaded document',
        fileName: file.originalname,
        filePath: `/uploads/pr-docs/${file.filename}`,
      });
    }

    const lead = await AustraliaPRLead.create({
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim().toLowerCase(),
      existingExperience: existingExperience || '',
      occupation,
      anzsco: anzsco || '',
      assessingBody: assessingBody || '',
      source,
      origin: origin || '',
      country: country || '',
      state: state || '',
      uploadedDocuments,
    });

    res.status(201).json(lead);
  } catch (error) {
    console.error('Create PR lead error:', error);
    res.status(500).json({ message: error.message || 'Failed to submit PR lead' });
  }
});

// @desc    Get all Australia PR leads
// @route   GET /api/pr-leads
// @access  Private (Admin)
router.get('/', protect, async (req, res) => {
  try {
    const leads = await AustraliaPRLead.find().sort({ createdAt: -1 });
    res.json(leads);
  } catch (error) {
    console.error('Get PR leads error:', error);
    res.status(500).json({ message: 'Failed to fetch PR leads' });
  }
});

// @desc    Get single PR lead
// @route   GET /api/pr-leads/:id
// @access  Private (Admin)
router.get('/:id', protect, async (req, res) => {
  try {
    const lead = await AustraliaPRLead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });
    res.json(lead);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch PR lead' });
  }
});

// @desc    Update PR lead (status, notes, or full profile)
// @route   PUT /api/pr-leads/:id
// @access  Private (Admin)
router.put('/:id', protect, async (req, res) => {
  try {
    const lead = await AustraliaPRLead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });

    const fields = [
      'name',
      'phone',
      'email',
      'existingExperience',
      'occupation',
      'anzsco',
      'assessingBody',
      'origin',
      'country',
      'state',
      'status',
      'adminNotes',
    ];

    fields.forEach((field) => {
      if (typeof req.body[field] !== 'undefined') {
        lead[field] = req.body[field];
      }
    });

    if (typeof lead.email === 'string') {
      lead.email = lead.email.trim().toLowerCase();
    }

    await lead.save();
    res.json(lead);
  } catch (error) {
    res.status(500).json({ message: 'Failed to update PR lead' });
  }
});

// @desc    Send email to PR lead
// @route   POST /api/pr-leads/:id/send-email
// @access  Private (Admin)
router.post('/:id/send-email', protect, mailUpload.array('attachments', 10), async (req, res) => {
  try {
    const lead = await AustraliaPRLead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });

    const subject = (req.body.subject || '').trim();
    const message = (req.body.message || '').trim();

    if (!subject) {
      return res.status(400).json({ message: 'Subject is required' });
    }
    if (!message) {
      return res.status(400).json({ message: 'Message body is required' });
    }

    const files = req.files || [];
    const attachmentListHtml = files.length
      ? `<ul style="margin:0;padding-left:20px;">${files
          .map((file) => `<li style="margin-bottom:6px;">${escapeHtml(file.originalname)}</li>`)
          .join('')}</ul>`
      : '<p style="margin:0;color:#64748b;">No files attached to this email.</p>';

    const emailHtml = `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#1e293b;max-width:640px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;background:#ffffff;">
        <div style="background:linear-gradient(135deg,#0d7c3d,#0a6331);color:#ffffff;padding:22px 24px;text-align:center;">
          <div style="font-size:13px;letter-spacing:0.4px;opacity:0.9;margin-bottom:6px;">RouteUp · Australia PR Guidance</div>
          <h2 style="margin:0;font-size:22px;font-weight:700;">Message from RouteUp</h2>
        </div>
        <div style="padding:28px 26px;">
          <p style="font-size:16px;margin:0 0 14px;">Hello <strong>${escapeHtml(lead.name)}</strong>,</p>
          <p style="font-size:15px;line-height:1.7;margin:0 0 22px;color:#475569;">
            You have received an update regarding your Australia PR enquiry with RouteUp.
          </p>

          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:18px 20px;margin-bottom:22px;">
            <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#0d7c3d;text-transform:uppercase;letter-spacing:0.5px;">Subject</p>
            <p style="margin:0;font-size:16px;font-weight:700;color:#0f172a;">${escapeHtml(subject)}</p>
          </div>

          <div style="background:#ffffff;border-left:4px solid #0d7c3d;padding:4px 0 4px 16px;margin-bottom:24px;">
            <p style="margin:0 0 10px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Message</p>
            <div style="font-size:15px;line-height:1.75;color:#334155;">${formatBodyHtml(message)}</div>
          </div>

          <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:16px 18px;margin-bottom:24px;">
            <p style="margin:0 0 10px;font-size:12px;font-weight:700;color:#1d4ed8;text-transform:uppercase;letter-spacing:0.5px;">Attachments</p>
            ${attachmentListHtml}
          </div>

          <div style="background:#f0faf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px 16px;margin-bottom:24px;font-size:13px;color:#166534;line-height:1.6;">
            <strong>Your enquiry:</strong> ${escapeHtml(lead.occupation || 'Australia PR')}
            ${lead.anzsco ? ` · ANZSCO ${escapeHtml(lead.anzsco)}` : ''}
            ${lead.assessingBody ? ` · ${escapeHtml(lead.assessingBody)}` : ''}
          </div>

          <p style="font-size:15px;line-height:1.6;margin:0 0 8px;color:#475569;">
            If you have questions, reply to this email and our team will assist you.
          </p>
          <p style="font-size:15px;margin:24px 0 0;">Best regards,<br/><strong>The RouteUp Team</strong><br/>
            <a href="mailto:hello@routeup.co.in" style="color:#0d7c3d;text-decoration:none;">hello@routeup.co.in</a>
          </p>
        </div>
        <div style="background:#f1f5f9;padding:14px;text-align:center;font-size:12px;color:#64748b;">
          &copy; ${new Date().getFullYear()} RouteUp. All rights reserved.
        </div>
      </div>
    `;

    const attachments = files.map((file) => ({
      filename: file.originalname,
      path: path.join(mailUploadDir, file.filename),
    }));

    await sendEmail({
      to: lead.email,
      subject: subject.startsWith('RouteUp') ? subject : `RouteUp: ${subject}`,
      htmlContent: emailHtml,
      attachments,
    });

    if (lead.status === 'New') {
      lead.status = 'Contacted';
      await lead.save();
    }

    res.json({ message: 'Email sent successfully', lead });
  } catch (error) {
    console.error('PR lead email error:', error);
    res.status(500).json({ message: error.message || 'Failed to send email' });
  }
});

// @desc    Delete PR lead
// @route   DELETE /api/pr-leads/:id
// @access  Private (Admin)
router.delete('/:id', protect, async (req, res) => {
  try {
    const lead = await AustraliaPRLead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });

    (lead.uploadedDocuments || []).forEach((doc) => {
      if (!doc.filePath) return;
      const abs = path.join(__dirname, '../..', doc.filePath.replace(/^\//, ''));
      if (fs.existsSync(abs)) {
        try {
          fs.unlinkSync(abs);
        } catch (err) {
          console.error('Failed to delete PR doc file:', err.message);
        }
      }
    });

    await lead.deleteOne();
    res.json({ message: 'Lead deleted', id: req.params.id });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete PR lead' });
  }
});

module.exports = router;
