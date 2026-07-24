const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const UniversityLead = require('../models/UniversityLead');
const Notification = require('../models/Notification');
const { protect } = require('../middleware/authMiddleware');
const { sendEmail } = require('../utils/mailer');
const { logAdminActivity } = require('../utils/activityLogger');
const socketHandler = require('../socket/socketHandler');
const { uploadToCloudinary, isCloudinaryUrl } = require('../utils/cloudinary');

const SCHOLARSHIP_SESSION_PRICE = 12000;

const storeFileOnCloudinary = async (filePath, folder) => {
  const secureUrl = await uploadToCloudinary(filePath, folder);
  if (!isCloudinaryUrl(secureUrl)) {
    throw new Error('Uploaded file must be stored on Cloudinary');
  }
  return secureUrl;
};

const mailUploadDir = path.join(__dirname, '../../uploads/university-mail');
if (!fs.existsSync(mailUploadDir)) {
  fs.mkdirSync(mailUploadDir, { recursive: true });
}

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
    if (ext === '.pdf') cb(null, true);
    else cb(new Error('Only PDF (.pdf) files are allowed'));
  },
});

const escapeHtml = (value = '') =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const parseCountries = (value) => {
  if (Array.isArray(value)) {
    return value.map((c) => String(c).trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((c) => String(c).trim()).filter(Boolean);
      }
    } catch {
      /* comma-separated */
    }
    return value
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
  }
  return [];
};

// @desc    Submit scholarship enquiry (public)
// @route   POST /api/university-leads
// @access  Public
router.post('/', async (req, res) => {
  try {
    const {
      name,
      phone,
      email,
      age,
      address,
      currentStatus,
      skills,
      preferredCountries,
      education,
      budget,
      timeline,
      notes,
      amount,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    if (!name?.trim() || !phone?.trim() || !email?.trim()) {
      return res.status(400).json({ message: 'Name, phone, and email are required' });
    }

    if (!age?.toString().trim() || !address?.trim() || !currentStatus?.trim() || !education?.trim()) {
      return res.status(400).json({
        message: 'Age, address, current status, and education are required',
      });
    }

    const countries = parseCountries(preferredCountries);
    if (countries.length === 0) {
      return res.status(400).json({ message: 'Please select at least one preferred country' });
    }

    if (!budget?.trim() || !timeline?.trim()) {
      return res.status(400).json({ message: 'Budget and timeline are required' });
    }

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

    const paidAmount = Number(amount) || SCHOLARSHIP_SESSION_PRICE;

    const lead = await UniversityLead.create({
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim().toLowerCase(),
      age: String(age).trim(),
      address: address.trim(),
      currentStatus: currentStatus.trim(),
      skills: (skills || '').trim(),
      preferredCountries: countries,
      education: education.trim(),
      budget: budget.trim(),
      timeline: timeline.trim(),
      notes: (notes || '').trim(),
      source: 'universities-book-session',
      amount: paidAmount,
      paymentStatus: 'Paid',
      paymentId: razorpay_payment_id,
    });

    try {
      const notification = await Notification.create({
        title: 'New Scholarship Lead',
        message: `${lead.name} paid Rs.${paidAmount} for a scholarship session (${countries.join(', ')}).`,
        type: 'new_lead',
        link: 'university-leads',
        isRead: false,
      });
      socketHandler.emitNewNotification(notification);
      socketHandler.emitNewUniversityLead(lead);
    } catch (socketErr) {
      console.error('Failed to emit new scholarship lead socket event:', socketErr);
    }

    res.status(201).json(lead);
  } catch (error) {
    console.error('Create scholarship lead error:', error);
    res.status(500).json({ message: error.message || 'Failed to submit enquiry' });
  }
});

// @desc    Get all scholarship leads (Admin)
// @route   GET /api/university-leads
// @access  Private
router.get('/', protect, async (_req, res) => {
  try {
    const leads = await UniversityLead.find().sort({ createdAt: -1 });
    res.json(leads);
  } catch (error) {
    console.error('Get scholarship leads error:', error);
    res.status(500).json({ message: 'Failed to fetch scholarship leads' });
  }
});

// @desc    Get single scholarship lead (Admin)
// @route   GET /api/university-leads/:id
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const lead = await UniversityLead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });
    res.json(lead);
  } catch (error) {
    console.error('Get scholarship lead error:', error);
    res.status(500).json({ message: 'Failed to fetch lead' });
  }
});

// @desc    Update scholarship lead (Admin)
// @route   PUT /api/university-leads/:id
// @access  Private
router.put('/:id', protect, async (req, res) => {
  try {
    const lead = await UniversityLead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });

    const fields = [
      'name',
      'phone',
      'email',
      'age',
      'address',
      'currentStatus',
      'skills',
      'education',
      'budget',
      'timeline',
      'notes',
      'status',
      'adminNotes',
    ];

    fields.forEach((field) => {
      if (typeof req.body[field] !== 'undefined') {
        lead[field] = req.body[field];
      }
    });

    if (typeof req.body.preferredCountries !== 'undefined') {
      lead.preferredCountries = parseCountries(req.body.preferredCountries);
    }

    if (typeof lead.email === 'string') {
      lead.email = lead.email.trim().toLowerCase();
    }

    await lead.save();

    await logAdminActivity(
      req.admin,
      'UPDATE_UNIVERSITY_LEAD',
      `Updated Scholarship lead for ${lead.name}`,
      {
        leadId: lead._id,
        candidateName: lead.name,
        status: lead.status,
        preferredCountries: lead.preferredCountries,
      }
    );

    socketHandler.emitUniversityLeadUpdated(lead);
    res.json(lead);
  } catch (error) {
    console.error('Update scholarship lead error:', error);
    res.status(500).json({ message: 'Failed to update lead' });
  }
});

// @desc    Send follow-up email
// @route   POST /api/university-leads/:id/send-email
// @access  Private
router.post('/:id/send-email', protect, mailUpload.array('documents', 10), async (req, res) => {
  try {
    const lead = await UniversityLead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });

    const { notes, subject } = req.body;

    if (!subject?.trim()) {
      return res.status(400).json({ message: 'Email subject is required.' });
    }

    if (!notes?.trim() && (!req.files || req.files.length === 0)) {
      return res.status(400).json({ message: 'Please add a message or upload at least one attachment.' });
    }

    if (notes?.trim()) {
      lead.adminNotes = notes.trim();
    }
    if (lead.status === 'New') {
      lead.status = 'Contacted';
    }
    await lead.save();

    const formattedNotes = (notes || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br/>');

    const attachmentListHtml =
      (req.files || []).length > 0
        ? `<ul style="margin: 0; padding-left: 20px;">${req.files
            .map((file) => `<li style="margin-bottom: 6px;">${escapeHtml(file.originalname)}</li>`)
            .join('')}</ul>`
        : '';

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
        <div style="background-color: #0d7c3d; color: #fff; padding: 15px; text-align: center;">
          <h2 style="margin: 0; font-size: 22px;">RouteUp — Scholarship Follow-Up</h2>
        </div>
        <div style="padding: 30px;">
          <p style="font-size: 16px;">Hello <strong>${escapeHtml(lead.name)}</strong>,</p>
          ${
            formattedNotes
              ? `<div style="font-size: 16px; line-height: 1.7; margin: 20px 0;">${formattedNotes}</div>`
              : '<p style="font-size: 16px; line-height: 1.5;">Please find the attached documents from our team.</p>'
          }
          ${
            attachmentListHtml
              ? `<div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 15px; margin: 25px 0;">
            <p style="margin: 0 0 10px 0; font-size: 14px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;"><strong>Attachments</strong></p>
            ${attachmentListHtml}
          </div>`
              : ''
          }
          <p style="font-size: 16px; line-height: 1.5;">If you have any questions, simply reply to this email and our team will assist you.</p>
          <p style="font-size: 16px; margin-top: 30px;">Best regards,<br/><strong>The RouteUp Team</strong></p>
        </div>
        <div style="background-color: #f1f5f9; padding: 15px; text-align: center; font-size: 12px; color: #64748b;">
          &copy; ${new Date().getFullYear()} RouteUp. All rights reserved.
        </div>
      </div>
    `;

    const attachments = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const content = fs.readFileSync(file.path);
        attachments.push({
          filename: file.originalname,
          content,
          contentType: file.mimetype || 'application/pdf',
        });
        await storeFileOnCloudinary(file.path, 'university-mail');
      }
    }

    await sendEmail({
      to: lead.email,
      subject: subject.trim(),
      htmlContent: emailHtml,
      attachments,
    });

    await logAdminActivity(
      req.admin,
      'SEND_UNIVERSITY_EMAIL',
      `Sent email to Scholarship lead candidate ${lead.name}`,
      {
        leadId: lead._id,
        candidateName: lead.name,
        email: lead.email,
        subject: subject.trim(),
        message: notes || '',
        attachments: (req.files || []).map((f) => f.originalname),
        isEmail: true,
      }
    );

    socketHandler.emitUniversityLeadUpdated(lead);
    res.json({ message: 'Email sent successfully!', lead });
  } catch (error) {
    console.error('Scholarship follow-up email error:', error);
    res.status(500).json({ message: error.message || 'Failed to send email' });
  }
});

// @desc    Delete scholarship lead
// @route   DELETE /api/university-leads/:id
// @access  Private
router.delete('/:id', protect, async (req, res) => {
  try {
    const lead = await UniversityLead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });

    const candidateName = lead.name;
    const leadId = lead._id.toString();
    await lead.deleteOne();

    await logAdminActivity(
      req.admin,
      'DELETE_UNIVERSITY_LEAD',
      `Deleted Scholarship lead for ${candidateName}`,
      { leadId, candidateName }
    );

    socketHandler.emitUniversityLeadDeleted(leadId);
    res.json({ message: 'Lead deleted', id: leadId });
  } catch (error) {
    console.error('Delete scholarship lead error:', error);
    res.status(500).json({ message: 'Failed to delete lead' });
  }
});

module.exports = router;
