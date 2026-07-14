const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
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
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
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
    const allowed = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.jpg', '.jpeg', '.png', '.webp'];
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
      amount,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    if (!name || !phone || !email || !occupation || !source) {
      return res.status(400).json({
        message: 'Name, phone, email, occupation, and source are required',
      });
    }

    // Eligibility check session requires Razorpay payment verification (Rs.2999)
    let paymentStatus = 'Pending';
    let paymentId = '';
    let paidAmount = Number(amount) || 0;

    if (source === 'eligibility-check') {
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ message: 'Payment details are missing' });
      }

      const bodyToHash = `${razorpay_order_id}|${razorpay_payment_id}`;
      const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(bodyToHash)
        .digest('hex');

      if (expectedSignature !== razorpay_signature) {
        return res.status(400).json({ message: 'Invalid payment signature. Submission aborted.' });
      }

      paymentStatus = 'Paid';
      paymentId = razorpay_payment_id;
      paidAmount = paidAmount || 2999;
    } else if (razorpay_order_id && razorpay_payment_id && razorpay_signature) {
      const bodyToHash = `${razorpay_order_id}|${razorpay_payment_id}`;
      const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(bodyToHash)
        .digest('hex');

      if (expectedSignature === razorpay_signature) {
        paymentStatus = 'Paid';
        paymentId = razorpay_payment_id;
        paidAmount = paidAmount || 2999;
      }
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
      amount: paidAmount,
      paymentStatus,
      paymentId,
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

// @desc    Send follow-up email to PR lead (same pattern as booking post-meeting)
// @route   POST /api/pr-leads/:id/send-email
// @access  Private (Admin)
router.post('/:id/send-email', protect, mailUpload.array('documents', 10), async (req, res) => {
  try {
    const lead = await AustraliaPRLead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });

    const { notes } = req.body;

    if (!notes?.trim() && (!req.files || req.files.length === 0)) {
      return res.status(400).json({ message: 'Please add notes or upload at least one file.' });
    }

    if (notes?.trim()) {
      lead.adminNotes = notes.trim();
    }
    if (lead.status === 'New') {
      lead.status = 'Contacted';
    }
    await lead.save();

    const formattedNotes = (notes || lead.adminNotes || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br/>');

    const attachmentListHtml = (req.files || []).length > 0
      ? `<ul style="margin: 0; padding-left: 20px;">${req.files.map((file) => `<li style="margin-bottom: 6px;">${escapeHtml(file.originalname)}</li>`).join('')}</ul>`
      : '<p style="margin: 0;">No new files attached in this email.</p>';

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
        <div style="background-color: #0d7c3d; color: #fff; padding: 15px; text-align: center;">
          <h2 style="margin: 0; font-size: 22px;">Your Australia PR Follow-Up is Ready</h2>
        </div>
        <div style="padding: 30px;">
          <p style="font-size: 16px;">Hello <strong>${escapeHtml(lead.name)}</strong>,</p>
          <p style="font-size: 16px; line-height: 1.5;">Thank you for sharing your Australia PR details with RouteUp. Please find your follow-up notes and shared documents below.</p>

          <div style="background-color: #f0faf4; border-left: 4px solid #0d7c3d; padding: 15px; margin: 25px 0;">
            <p style="margin: 0 0 10px 0; font-size: 14px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;"><strong>Your Enquiry</strong></p>
            <p style="margin: 0; font-size: 15px; line-height: 1.6;">
              ${escapeHtml(lead.occupation || 'Australia PR')}
              ${lead.anzsco ? ` · ANZSCO ${escapeHtml(lead.anzsco)}` : ''}
              ${lead.assessingBody ? ` · ${escapeHtml(lead.assessingBody)}` : ''}
            </p>
          </div>

          <div style="background-color: #f8fafc; border-left: 4px solid #0d7c3d; padding: 15px; margin: 25px 0;">
            <p style="margin: 0 0 10px 0; font-size: 14px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;"><strong>Follow-Up Notes</strong></p>
            <p style="margin: 0; font-size: 16px; line-height: 1.6;">${formattedNotes || 'Our team has shared follow-up documents with you.'}</p>
          </div>

          <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 15px; margin: 25px 0;">
            <p style="margin: 0 0 10px 0; font-size: 14px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;"><strong>Attached Files</strong></p>
            ${attachmentListHtml}
          </div>

          <p style="font-size: 16px; line-height: 1.5;">If you have any questions about your next steps, simply reply to this email and our team will assist you.</p>

          <p style="font-size: 16px; margin-top: 30px;">Best regards,<br/><strong>The RouteUp Team</strong></p>
        </div>
        <div style="background-color: #f1f5f9; padding: 15px; text-align: center; font-size: 12px; color: #64748b;">
          &copy; ${new Date().getFullYear()} RouteUp. All rights reserved.
        </div>
      </div>
    `;

    const attachments = (req.files || []).map((file) => ({
      filename: file.originalname,
      path: path.join(mailUploadDir, file.filename),
    }));

    await sendEmail({
      to: lead.email,
      subject: 'RouteUp: Your Australia PR Follow-Up & Documents',
      htmlContent: emailHtml,
      attachments,
    });

    res.json({ message: 'Notes uploaded and email sent!', lead });
  } catch (error) {
    console.error('PR lead email error:', error);
    res.status(500).json({ message: error.message });
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
