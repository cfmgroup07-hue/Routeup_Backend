const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const AustraliaPRLead = require('../models/AustraliaPRLead');
const Notification = require('../models/Notification');
const { protect } = require('../middleware/authMiddleware');
const { sendEmail } = require('../utils/mailer');
const { logAdminActivity } = require('../utils/activityLogger');
const socketHandler = require('../socket/socketHandler');
const { uploadToCloudinary, deleteFromCloudinary, isCloudinaryUrl, isLocalUploadPath, assertCloudinaryDocumentPaths, getDocumentViewUrl, getDocumentDownloadUrl, isPdfCloudinaryUrl } = require('../utils/cloudinary');
const { resolveStoredFileUrl } = require('../utils/resolveFileUrl');

const storeFileOnCloudinary = async (filePath, folder) => {
  const secureUrl = await uploadToCloudinary(filePath, folder);
  if (!isCloudinaryUrl(secureUrl)) {
    throw new Error('Uploaded file must be stored on Cloudinary');
  }
  return secureUrl;
};


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
    if (ext === '.pdf') cb(null, true);
    else cb(new Error('Only PDF (.pdf) files are allowed'));
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
      applicationDetails,
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
    const uploadedDocuments = [];

    const itemsList = Array.isArray(metaList) ? metaList : [];
    for (const item of itemsList) {
      const doc = {
        title: item.title || 'Document',
        fileName: item.fileName || '',
        filePath: '',
      };
      if (item.attached && files[fileIdx]) {
        const file = files[fileIdx++];
        doc.fileName = file.originalname;
        doc.filePath = await storeFileOnCloudinary(file.path, 'pr-docs');
      }
      uploadedDocuments.push(doc);
    }

    while (fileIdx < files.length) {
      const file = files[fileIdx++];
      const secureUrl = await storeFileOnCloudinary(file.path, 'pr-docs');
      uploadedDocuments.push({
        title: 'Uploaded document',
        fileName: file.originalname,
        filePath: secureUrl,
      });
    }


    let parsedApplicationDetails = {};
    if (applicationDetails) {
      try {
        parsedApplicationDetails =
          typeof applicationDetails === 'string'
            ? JSON.parse(applicationDetails)
            : applicationDetails;
      } catch {
        parsedApplicationDetails = {};
      }
    }

    assertCloudinaryDocumentPaths(
      uploadedDocuments.filter((doc) => doc.filePath)
    );

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
      applicationDetails: parsedApplicationDetails,
    });

    try {
      const notification = await Notification.create({
        title: 'New Australia PR Lead',
        message: `${lead.name} submitted an Australia PR enquiry (${lead.occupation}).`,
        type: 'new_lead',
        link: 'australia-pr',
        isRead: false,
      });
      socketHandler.emitNewNotification(notification);
      socketHandler.emitNewAustraliaPrLead(lead);
    } catch (socketErr) {
      console.error('Failed to emit new PR lead socket event:', socketErr);
    }

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

// @desc    Resolve a document URL (Cloudinary). Migrates legacy /uploads paths when possible.
// @route   GET /api/pr-leads/:id/document-url
// @access  Private
router.get('/:id/document-url', protect, async (req, res) => {
  let lead;
  let doc;
  try {
    const { title } = req.query;
    if (!title) {
      return res.status(400).json({ message: 'Document title is required' });
    }

    lead = await AustraliaPRLead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });

    doc = (lead.uploadedDocuments || []).find((d) => d.title === title);
    if (!doc?.filePath) {
      return res.status(404).json({ message: 'Document not found' });
    }

    const url = await resolveStoredFileUrl(doc.filePath, 'pr-docs');
    if (url !== doc.filePath) {
      doc.filePath = url;
      lead.markModified('uploadedDocuments');
      await lead.save();
      socketHandler.emitAustraliaPrLeadUpdated(lead);
    }

    return res.json({
      url: doc.filePath,
      viewUrl: getDocumentViewUrl(doc.filePath),
      downloadUrl: getDocumentDownloadUrl(doc.filePath),
      isPdf: isPdfCloudinaryUrl(doc.filePath),
    });
  } catch (error) {
    console.error('Resolve PR document URL error:', error);

    if (lead && doc && isLocalUploadPath(doc.filePath)) {
      doc.needsReupload = true;
      doc.reuploadNote =
        doc.reuploadNote ||
        'Original file could not be found. Please upload this document again.';
      doc.filePath = '';
      lead.markModified('uploadedDocuments');
      await lead.save();
      socketHandler.emitAustraliaPrLeadUpdated(lead);
    }

    return res.status(404).json({ message: error.message || 'Document unavailable' });
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

    await logAdminActivity(
      req.admin,
      'UPDATE_PR_LEAD',
      `Updated Australia PR lead for ${lead.name}`,
      { leadId: lead._id, candidateName: lead.name, status: lead.status, occupation: lead.occupation }
    );

    socketHandler.emitAustraliaPrLeadUpdated(lead);

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

    const attachmentListHtml = (req.files || []).length > 0
      ? `<ul style="margin: 0; padding-left: 20px;">${req.files.map((file) => `<li style="margin-bottom: 6px;">${escapeHtml(file.originalname)}</li>`).join('')}</ul>`
      : '';

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
        <div style="background-color: #0d7c3d; color: #fff; padding: 15px; text-align: center;">
          <h2 style="margin: 0; font-size: 22px;">RouteUp — Australia PR Follow-Up</h2>
        </div>
        <div style="padding: 30px;">
          <p style="font-size: 16px;">Hello <strong>${escapeHtml(lead.name)}</strong>,</p>
          ${formattedNotes
            ? `<div style="font-size: 16px; line-height: 1.7; margin: 20px 0;">${formattedNotes}</div>`
            : '<p style="font-size: 16px; line-height: 1.5;">Please find the attached documents from our team.</p>'}

          ${attachmentListHtml
            ? `<div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 15px; margin: 25px 0;">
            <p style="margin: 0 0 10px 0; font-size: 14px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;"><strong>Attachments</strong></p>
            ${attachmentListHtml}
          </div>`
            : ''}

          <p style="font-size: 16px; line-height: 1.5;">If you have any questions, simply reply to this email and our team will assist you.</p>

          <p style="font-size: 16px; margin-top: 30px;">Best regards,<br/><strong>The RouteUp Team</strong></p>
        </div>
        <div style="background-color: #f1f5f9; padding: 15px; text-align: center; font-size: 12px; color: #64748b;">
          &copy; ${new Date().getFullYear()} RouteUp. All rights reserved.
        </div>
      </div>
    `;

    const uploadedPaths = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const secureUrl = await storeFileOnCloudinary(file.path, 'pr-mail');
        uploadedPaths.push(secureUrl);
      }
    }

    const attachments = (req.files || []).map((file, index) => ({
      filename: file.originalname,
      path: uploadedPaths[index],
    }));


    await sendEmail({
      to: lead.email,
      subject: subject.trim(),
      htmlContent: emailHtml,
      attachments,
    });

    await logAdminActivity(
      req.admin,
      'SEND_PR_EMAIL',
      `Sent email to Australia PR candidate ${lead.name}`,
      {
        leadId: lead._id,
        candidateName: lead.name,
        email: lead.email,
        subject: subject.trim(),
        message: notes || '',
        attachments: (req.files || []).map(f => f.originalname),
        isEmail: true
      }
    );

    socketHandler.emitAustraliaPrLeadUpdated(lead);

    res.json({ message: 'Email sent successfully!', lead });
  } catch (error) {
    console.error('PR lead email error:', error);
    res.status(500).json({ message: error.message });
  }
});

// @desc    Delete a specific uploaded document
// @route   DELETE /api/pr-leads/:id/document
// @access  Private (Admin)
router.delete('/:id/document', protect, async (req, res) => {
  const { title } = req.body;
  if (!title) {
    return res.status(400).json({ message: 'Document title is required' });
  }

  try {
    const lead = await AustraliaPRLead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });

    const docIndex = (lead.uploadedDocuments || []).findIndex((d) => d.title === title);
    if (docIndex === -1) {
      return res.status(404).json({ message: 'Document not found' });
    }

    const doc = lead.uploadedDocuments[docIndex];
    if (doc.filePath) {
      if (doc.filePath.includes('cloudinary.com')) {
        await deleteFromCloudinary(doc.filePath);
      } else {
        const abs = path.join(__dirname, '../..', doc.filePath.replace(/^\//, ''));
        if (fs.existsSync(abs)) {
          try {
            fs.unlinkSync(abs);
          } catch (err) {
            console.error('Failed to delete PR doc file:', err.message);
          }
        }
      }
    }


    if (doc.needsReupload) {
      doc.fileName = '';
      doc.filePath = '';
    } else {
      lead.uploadedDocuments.splice(docIndex, 1);
    }

    lead.markModified('uploadedDocuments');
    await lead.save();

    socketHandler.emitAustraliaPrLeadUpdated(lead);

    await logAdminActivity(
      req.admin,
      'DELETE_PR_DOCUMENT',
      `Deleted document "${title}" for Australia PR lead ${lead.name}`,
      { leadId: lead._id, candidateName: lead.name, documentTitle: title }
    );

    res.json({ message: 'Document deleted successfully', lead });
  } catch (error) {
    console.error('Delete PR document error:', error);
    res.status(500).json({ message: 'Failed to delete document' });
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

    const candidateName = lead.name;
    const leadId = lead._id.toString();
    await lead.deleteOne();

    await logAdminActivity(
      req.admin,
      'DELETE_PR_LEAD',
      `Deleted Australia PR lead for ${candidateName}`,
      { leadId, candidateName }
    );

    socketHandler.emitAustraliaPrLeadDeleted(leadId);

    res.json({ message: 'Lead deleted', id: leadId });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete PR lead' });
  }
});

// @desc    Public: fetch documents that need re-upload for Australia PR leads
// @route   GET /api/pr-leads/reupload/:token
// @access  Public
router.get('/reupload/:token', async (req, res) => {
  try {
    const lead = await AustraliaPRLead.findOne({ reuploadToken: req.params.token });
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
        occupation: lead.occupation,
        completed: true,
        documents: [],
        message: 'All requested documents have already been re-uploaded. Thank you!',
      });
    }

    res.json({
      name: lead.name,
      occupation: lead.occupation,
      completed: false,
      documents: docs.map((d) => ({
        title: d.title,
        reuploadNote: d.reuploadNote || '',
        currentFileName: d.fileName || '',
      })),
    });
  } catch (error) {
    console.error('Get PR reupload token error:', error);
    res.status(500).json({ message: 'Failed to load re-upload details' });
  }
});

// @desc    Public: submit replacement documents for Australia PR leads
// @route   POST /api/pr-leads/reupload/:token
// @access  Public
router.post('/reupload/:token', upload.array('documents', 40), async (req, res) => {
  try {
    const lead = await AustraliaPRLead.findOne({ reuploadToken: req.params.token });
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

    const deleteFileIfExists = async (filePath) => {
      if (!filePath) return;
      if (filePath.includes('cloudinary.com')) {
        await deleteFromCloudinary(filePath);
      } else {
        const fullPath = path.join(__dirname, '../..', filePath.replace(/^\//, ''));
        if (fs.existsSync(fullPath)) {
          try {
            fs.unlinkSync(fullPath);
          } catch {
            /* ignore */
          }
        }
      }
    };

    for (const item of metaList) {
      if (!item.title || !pendingTitles.has(item.title)) continue;
      if (!item.attached || !files[fileIdx]) {
        return res.status(400).json({ message: `Missing file for: ${item.title}` });
      }

      const file = files[fileIdx++];
      const doc = lead.uploadedDocuments.find((d) => d.title === item.title);
      if (!doc) continue;

      await deleteFileIfExists(doc.filePath);
      doc.fileName = file.originalname;
      doc.filePath = await storeFileOnCloudinary(file.path, 'pr-docs');
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

    // Create and save notification for the admin
    try {
      const notification = await Notification.create({
        title: 'PR Documents Re-uploaded',
        message: `${lead.name} has re-uploaded requested documents for ${lead.occupation}.`,
        type: 'document_reupload',
        link: 'australia-pr',
        isRead: false,
      });
      socketHandler.emitNewNotification(notification);
    } catch (notifErr) {
      console.error('Failed to create/emit notification:', notifErr);
    }

    socketHandler.emitAustraliaPrLeadUpdated(lead);

    res.json({
      message: stillPending
        ? 'Some documents updated. Remaining requested files can still be uploaded with this link.'
        : 'All requested documents updated successfully.',
      completed: !stillPending,
      lead,
    });
  } catch (error) {
    console.error('Submit PR reupload error:', error);
    res.status(500).json({ message: error.message || 'Failed to update documents' });
  }
});

// @desc    Request re-upload of incorrect documents for PR lead + email candidate
// @route   POST /api/pr-leads/:id/request-reupload
// @access  Private (Admin)
router.post('/:id/request-reupload', protect, async (req, res) => {
  try {
    const lead = await AustraliaPRLead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });

    const { documentTitles = [], message = '' } = req.body;
    if (!Array.isArray(documentTitles) || documentTitles.length === 0) {
      return res.status(400).json({ message: 'Select at least one document to request.' });
    }

    const titleSet = new Set(documentTitles.map((t) => String(t || '').trim()).filter(Boolean));
    if (titleSet.size === 0) {
      return res.status(400).json({ message: 'Select at least one document to request.' });
    }

    if (!Array.isArray(lead.uploadedDocuments)) {
      lead.uploadedDocuments = [];
    }

    const note =
      message ||
      'Please upload a clearer / correct version of this document (or upload it if you have not yet).';

    let marked = 0;
    for (const title of titleSet) {
      let doc = lead.uploadedDocuments.find((d) => d.title === title);
      if (!doc) {
        // Admin can request upload for docs the candidate never submitted
        lead.uploadedDocuments.push({
          title,
          fileName: '',
          filePath: '',
          needsReupload: true,
          reuploadNote: note,
        });
        marked += 1;
      } else {
        doc.needsReupload = true;
        doc.reuploadNote = note;
        marked += 1;
      }
    }

    if (marked === 0) {
      return res.status(400).json({ message: 'Could not mark any documents for re-upload.' });
    }

    lead.markModified('uploadedDocuments');

    const token = crypto.randomBytes(24).toString('hex');
    lead.reuploadToken = token;
    lead.reuploadExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    if (lead.status === 'New') lead.status = 'Contacted';
    await lead.save();
    const host = req.get('host') || '';
    const origin = req.get('origin') || req.headers.origin || '';

    let frontendBase = 'https://routeup.co.in'; // Default live

    // If the request originates from a browser, use the origin
    if (origin && origin.startsWith('http')) {
      frontendBase = origin;
    } else if (process.env.CLIENT_URL) {
      frontendBase = process.env.CLIENT_URL;
    }

    // Guard against sending localhost URLs in production
    const isLocalRequest = host.includes('localhost') || host.includes('127.0.0.1');
    if (!isLocalRequest && frontendBase.includes('localhost')) {
      frontendBase = 'https://routeup.co.in';
    }

    frontendBase = frontendBase.replace(/\/$/, '');
    const reuploadUrl = `${frontendBase}/australia-pr-reupload/${token}`;

    const docListHtml = documentTitles
      .map((t) => `<li style="margin:6px 0;">${escapeHtml(t)}</li>`)
      .join('');

    const htmlContent = `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1a1a2e;">
        <h2 style="color:#0d7c3d;">Action needed: re-upload documents</h2>
        <p>Hi ${escapeHtml(lead.name)},</p>
        <p>Our team reviewed your Australia PR application for <strong>${escapeHtml(lead.occupation)}</strong> and needs you to upload the following documents:</p>
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
        subject: 'RouteUp — Please re-upload your Australia PR documents',
        htmlContent,
      });
    } catch (err) {
      emailSent = false;
      emailError = err.message || 'SMTP send failed';
      console.error('Re-upload email failed:', err);
    }

    socketHandler.emitAustraliaPrLeadUpdated(lead);

    if (!emailSent) {
      await logAdminActivity(
        req.admin,
        'REQUEST_PR_REUPLOAD',
        `Requested PR document re-upload from candidate ${lead.name} (Email failed)`,
        {
          leadId: lead._id,
          candidateName: lead.name,
          email: lead.email,
          subject: 'RouteUp — Please re-upload your Australia PR documents',
          requestedDocuments: documentTitles,
          message: message || '',
          reuploadUrl,
          isEmail: true,
          emailSent: false,
          emailError
        }
      );

      return res.status(502).json({
        message: `Documents marked for re-upload, but email failed: ${emailError}. Share this link manually: ${reuploadUrl}`,
        lead,
        reuploadUrl,
        emailSent: false,
      });
    }

    await logAdminActivity(
      req.admin,
      'REQUEST_PR_REUPLOAD',
      `Requested PR document re-upload from candidate ${lead.name}`,
      {
        leadId: lead._id,
        candidateName: lead.name,
        email: lead.email,
        subject: 'RouteUp — Please re-upload your Australia PR documents',
        requestedDocuments: documentTitles,
        message: message || '',
        reuploadUrl,
        isEmail: true,
        emailSent: true
      }
    );

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

module.exports = router;
