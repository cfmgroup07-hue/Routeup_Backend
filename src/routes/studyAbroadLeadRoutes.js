const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const StudyAbroadLead = require('../models/StudyAbroadLead');
const { protect } = require('../middleware/authMiddleware');
const { sendEmail } = require('../utils/mailer');
const socketHandler = require('../socket/socketHandler');

const uploadDir = path.join(__dirname, '../../uploads/study-abroad-docs');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `sa-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.webp'];
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only PDF, DOC, DOCX, and image files are allowed'));
  },
});

const escapeHtml = (value = '') =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const resolveUploadPath = (filePath = '') => {
  const relative = String(filePath).replace(/^\//, '');
  return path.join(__dirname, '../..', relative);
};

const deleteFileIfExists = (filePath) => {
  if (!filePath) return;
  const fullPath = resolveUploadPath(filePath);
  if (fs.existsSync(fullPath)) {
    try {
      fs.unlinkSync(fullPath);
    } catch {
      /* ignore */
    }
  }
};

// @desc    Submit study abroad lead (public)
// @route   POST /api/study-abroad-leads
// @access  Public
router.post('/', upload.array('documents', 40), async (req, res) => {
  try {
    const {
      name,
      phone,
      email,
      applyingCourse,
      targetUniversity,
      country,
      documentMeta,
      totalRequired,
    } = req.body;

    if (!name || !phone || !email || !applyingCourse || !country) {
      return res.status(400).json({
        message: 'Name, phone, email, course, and destination country are required',
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
        needsReupload: false,
        reuploadNote: '',
      };
      if (item.attached && files[fileIdx]) {
        const file = files[fileIdx++];
        doc.fileName = file.originalname;
        doc.filePath = `/uploads/study-abroad-docs/${file.filename}`;
      }
      return doc;
    });

    while (fileIdx < files.length) {
      const file = files[fileIdx++];
      uploadedDocuments.push({
        title: 'Uploaded document',
        fileName: file.originalname,
        filePath: `/uploads/study-abroad-docs/${file.filename}`,
        needsReupload: false,
        reuploadNote: '',
      });
    }

    const lead = await StudyAbroadLead.create({
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim().toLowerCase(),
      applyingCourse: applyingCourse.trim(),
      targetUniversity: (targetUniversity || '').trim(),
      country: country.trim(),
      uploadedDocuments,
      totalRequired: Number(totalRequired) || uploadedDocuments.length,
    });

    res.status(201).json(lead);
  } catch (error) {
    console.error('Create study abroad lead error:', error);
    res.status(500).json({ message: error.message || 'Failed to submit study abroad lead' });
  }
});

// @desc    Public: fetch documents that need re-upload
// @route   GET /api/study-abroad-leads/reupload/:token
// @access  Public
router.get('/reupload/:token', async (req, res) => {
  try {
    const lead = await StudyAbroadLead.findOne({ reuploadToken: req.params.token });
    if (!lead) {
      return res.status(404).json({ message: 'This re-upload link is invalid or has expired.' });
    }
    if (lead.reuploadExpiresAt && new Date(lead.reuploadExpiresAt) < new Date()) {
      return res.status(410).json({ message: 'This re-upload link has expired. Please contact RouteUp.' });
    }

    const docs = (lead.uploadedDocuments || []).filter((d) => d.needsReupload);
    if (docs.length === 0) {
      return res.json({
        name: lead.name,
        country: lead.country,
        applyingCourse: lead.applyingCourse,
        completed: true,
        documents: [],
        message: 'All requested documents have already been re-uploaded. Thank you!',
      });
    }

    res.json({
      name: lead.name,
      country: lead.country,
      applyingCourse: lead.applyingCourse,
      completed: false,
      documents: docs.map((d) => ({
        title: d.title,
        reuploadNote: d.reuploadNote || '',
        currentFileName: d.fileName || '',
      })),
    });
  } catch (error) {
    console.error('Get reupload token error:', error);
    res.status(500).json({ message: 'Failed to load re-upload details' });
  }
});

// @desc    Public: submit replacement documents
// @route   POST /api/study-abroad-leads/reupload/:token
// @access  Public
router.post('/reupload/:token', upload.array('documents', 40), async (req, res) => {
  try {
    const lead = await StudyAbroadLead.findOne({ reuploadToken: req.params.token });
    if (!lead) {
      return res.status(404).json({ message: 'This re-upload link is invalid or has expired.' });
    }
    if (lead.reuploadExpiresAt && new Date(lead.reuploadExpiresAt) < new Date()) {
      return res.status(410).json({ message: 'This re-upload link has expired. Please contact RouteUp.' });
    }

    let metaList = [];
    if (req.body.documentMeta) {
      try {
        metaList =
          typeof req.body.documentMeta === 'string'
            ? JSON.parse(req.body.documentMeta)
            : req.body.documentMeta;
      } catch {
        metaList = [];
      }
    }

    if (!Array.isArray(metaList) || metaList.length === 0) {
      return res.status(400).json({ message: 'Please upload the requested documents.' });
    }

    const files = req.files || [];
    let fileIdx = 0;
    const pendingTitles = new Set(
      (lead.uploadedDocuments || []).filter((d) => d.needsReupload).map((d) => d.title)
    );

    for (const item of metaList) {
      if (!item.title || !pendingTitles.has(item.title)) continue;
      if (!item.attached || !files[fileIdx]) {
        return res.status(400).json({ message: `Missing file for: ${item.title}` });
      }

      const file = files[fileIdx++];
      const doc = lead.uploadedDocuments.find((d) => d.title === item.title);
      if (!doc) continue;

      deleteFileIfExists(doc.filePath);
      doc.fileName = file.originalname;
      doc.filePath = `/uploads/study-abroad-docs/${file.filename}`;
      doc.needsReupload = false;
      doc.reuploadNote = '';
    }

    const stillPending = (lead.uploadedDocuments || []).some((d) => d.needsReupload);
    if (!stillPending) {
      lead.reuploadToken = '';
      lead.reuploadExpiresAt = undefined;
    }

    if (lead.status === 'New') {
      lead.status = 'Contacted';
    }

    await lead.save();

    try {
      socketHandler.emitStudyAbroadLeadUpdated(lead);
    } catch {
      /* ignore */
    }

    res.json({
      message: stillPending
        ? 'Some documents updated. Remaining requested files can still be uploaded with this link.'
        : 'All requested documents updated successfully.',
      completed: !stillPending,
      lead,
    });
  } catch (error) {
    console.error('Submit reupload error:', error);
    res.status(500).json({ message: error.message || 'Failed to update documents' });
  }
});

// @desc    Get all study abroad leads (optionally filter by country)
// @route   GET /api/study-abroad-leads
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const filter = {};
    if (req.query.country) filter.country = req.query.country;
    const leads = await StudyAbroadLead.find(filter).sort({ createdAt: -1 });
    res.json(leads);
  } catch (error) {
    console.error('Get study abroad leads error:', error);
    res.status(500).json({ message: 'Failed to fetch study abroad leads' });
  }
});

// @desc    Request re-upload of incorrect documents + email student
// @route   POST /api/study-abroad-leads/:id/request-reupload
// @access  Private
router.post('/:id/request-reupload', protect, async (req, res) => {
  try {
    const lead = await StudyAbroadLead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });

    const { documentTitles = [], message = '' } = req.body;
    if (!Array.isArray(documentTitles) || documentTitles.length === 0) {
      return res.status(400).json({ message: 'Select at least one incorrect document.' });
    }

    const titleSet = new Set(documentTitles);
    let marked = 0;
    (lead.uploadedDocuments || []).forEach((doc) => {
      if (titleSet.has(doc.title)) {
        doc.needsReupload = true;
        doc.reuploadNote = message || 'Please upload a clearer / correct version of this document.';
        marked += 1;
      }
    });

    if (marked === 0) {
      return res.status(400).json({ message: 'None of the selected documents were found on this lead.' });
    }

    const token = crypto.randomBytes(24).toString('hex');
    lead.reuploadToken = token;
    lead.reuploadExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    if (lead.status === 'New') lead.status = 'Contacted';
    await lead.save();

    const frontendBase = (process.env.CLIENT_URL || 'https://routeup.co.in').replace(/\/$/, '');
    const reuploadUrl = `${frontendBase}/study-abroad-reupload/${token}`;

    const docListHtml = documentTitles
      .map((t) => `<li style="margin:6px 0;">${escapeHtml(t)}</li>`)
      .join('');

    const htmlContent = `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1a1a2e;">
        <h2 style="color:#0d7c3d;">Action needed: re-upload documents</h2>
        <p>Hi ${escapeHtml(lead.name)},</p>
        <p>Our team reviewed your study abroad documents for <strong>${escapeHtml(lead.country)}</strong>
        (${escapeHtml(lead.applyingCourse)}) and needs a corrected copy of the following:</p>
        <ul style="padding-left:20px;">${docListHtml}</ul>
        ${
          message
            ? `<p style="background:#fff8f0;border:1px solid #f0d9b5;padding:12px 16px;border-radius:8px;color:#6b4f1d;">
                <strong>Note from RouteUp:</strong> ${escapeHtml(message)}
              </p>`
            : ''
        }
        <p style="margin:24px 0;">
          <a href="${reuploadUrl}"
             style="display:inline-block;background:#0d7c3d;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;">
            Re-upload documents
          </a>
        </p>
        <p style="font-size:13px;color:#666;">Or open this link:<br/><a href="${reuploadUrl}">${reuploadUrl}</a></p>
        <p style="font-size:13px;color:#666;">This link expires in 7 days.</p>
        <p>Thanks,<br/>RouteUp Team</p>
      </div>
    `;

    let emailSent = true;
    let emailError = '';
    try {
      await sendEmail({
        to: lead.email,
        subject: 'RouteUp — Please re-upload your study abroad documents',
        htmlContent,
      });
    } catch (err) {
      emailSent = false;
      emailError = err.message || 'SMTP send failed';
      console.error('Re-upload email failed:', err);
    }

    try {
      socketHandler.emitStudyAbroadLeadUpdated(lead);
    } catch {
      /* ignore */
    }

    if (!emailSent) {
      return res.status(502).json({
        message: `Documents marked for re-upload, but email failed: ${emailError}. Share this link manually: ${reuploadUrl}`,
        lead,
        reuploadUrl,
        emailSent: false,
      });
    }

    res.json({
      message: 'Re-upload email sent successfully',
      lead,
      reuploadUrl,
      emailSent: true,
    });
  } catch (error) {
    console.error('Request reupload error:', error);
    res.status(500).json({
      message: error.message || 'Failed to send re-upload email. Check SMTP settings.',
    });
  }
});

// @desc    Get single lead
// @route   GET /api/study-abroad-leads/:id
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const lead = await StudyAbroadLead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });
    res.json(lead);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch lead' });
  }
});

// @desc    Update lead
// @route   PUT /api/study-abroad-leads/:id
// @access  Private
router.put('/:id', protect, async (req, res) => {
  try {
    const lead = await StudyAbroadLead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });

    const fields = [
      'name',
      'phone',
      'email',
      'applyingCourse',
      'targetUniversity',
      'country',
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
    console.error('Update study abroad lead error:', error);
    res.status(500).json({ message: 'Failed to update lead' });
  }
});

// @desc    Delete lead
// @route   DELETE /api/study-abroad-leads/:id
// @access  Private
router.delete('/:id', protect, async (req, res) => {
  try {
    const lead = await StudyAbroadLead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });

    (lead.uploadedDocuments || []).forEach((doc) => {
      deleteFileIfExists(doc.filePath);
    });

    await lead.deleteOne();
    res.json({ message: 'Lead deleted' });
  } catch (error) {
    console.error('Delete study abroad lead error:', error);
    res.status(500).json({ message: 'Failed to delete lead' });
  }
});

module.exports = router;
