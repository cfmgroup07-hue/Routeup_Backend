const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const StudyAbroadLead = require('../models/StudyAbroadLead');
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
    if (ext === '.pdf') cb(null, true);
    else cb(new Error('Only PDF (.pdf) files are allowed'));
  },
});

const mailUploadDir = path.join(__dirname, '../../uploads/study-abroad-mail');
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

const resolveUploadPath = (filePath = '') => {
  const relative = String(filePath).replace(/^\//, '');
  return path.join(__dirname, '../..', relative);
};

const deleteFileIfExists = async (filePath) => {
  if (!filePath) return;
  if (filePath.includes('cloudinary.com')) {
    await deleteFromCloudinary(filePath);
  } else {
    const fullPath = resolveUploadPath(filePath);
    if (fs.existsSync(fullPath)) {
      try {
        fs.unlinkSync(fullPath);
      } catch {
        /* ignore */
      }
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
    const uploadedDocuments = [];

    const itemsList = Array.isArray(metaList) ? metaList : [];
    for (const item of itemsList) {
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
        doc.filePath = await storeFileOnCloudinary(file.path, 'study-abroad-docs');
      }
      uploadedDocuments.push(doc);
    }

    while (fileIdx < files.length) {
      const file = files[fileIdx++];
      const secureUrl = await storeFileOnCloudinary(file.path, 'study-abroad-docs');
      uploadedDocuments.push({
        title: 'Uploaded document',
        fileName: file.originalname,
        filePath: secureUrl,
        needsReupload: false,
        reuploadNote: '',
      });
    }


    assertCloudinaryDocumentPaths(
      uploadedDocuments.filter((doc) => doc.filePath)
    );

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

    try {
      const notification = await Notification.create({
        title: 'New Study Abroad Lead',
        message: `${lead.name} submitted study abroad documents for ${lead.applyingCourse} (${lead.country}).`,
        type: 'new_lead',
        link: 'students',
        isRead: false,
      });
      socketHandler.emitNewNotification(notification);
      socketHandler.emitNewStudyAbroadLead(lead);
    } catch (socketErr) {
      console.error('Failed to emit new study abroad lead socket event:', socketErr);
    }

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

      await deleteFileIfExists(doc.filePath);
      doc.fileName = file.originalname;
      doc.filePath = await storeFileOnCloudinary(file.path, 'study-abroad-docs');
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

    assertCloudinaryDocumentPaths(
      (lead.uploadedDocuments || []).filter((doc) => doc.filePath)
    );

    await lead.save();

    // Create and save notification for the admin
    try {
      const notification = await Notification.create({
        title: 'Documents Re-uploaded',
        message: `${lead.name} has re-uploaded requested documents for ${lead.applyingCourse} (${lead.country}).`,
        type: 'document_reupload',
        link: 'students',
        isRead: false,
      });
      socketHandler.emitNewNotification(notification);
    } catch (notifErr) {
      console.error('Failed to create/emit notification:', notifErr);
    }

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

// @desc    Send follow-up email to study abroad student
// @route   POST /api/study-abroad-leads/:id/send-email
// @access  Private
router.post('/:id/send-email', protect, mailUpload.array('documents', 10), async (req, res) => {
  try {
    const lead = await StudyAbroadLead.findById(req.params.id);
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
          <h2 style="margin: 0; font-size: 22px;">RouteUp — Study Abroad Follow-Up</h2>
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
        const secureUrl = await storeFileOnCloudinary(file.path, 'study-abroad-mail');
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
      'SEND_STUDENT_EMAIL',
      `Sent email to Study Abroad candidate ${lead.name}`,
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

    socketHandler.emitStudyAbroadLeadUpdated(lead);

    res.json({ message: 'Email sent successfully!', lead });
  } catch (error) {
    console.error('Study abroad follow-up email error:', error);
    res.status(500).json({ message: error.message || 'Failed to send email' });
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
        // Admin can request upload for docs the student never submitted
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
    const reuploadUrl = `${frontendBase}/study-abroad-reupload/${token}`;

    const docListHtml = documentTitles
      .map((t) => `<li style="margin:6px 0;">${escapeHtml(t)}</li>`)
      .join('');

    const htmlContent = `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1a1a2e;">
        <h2 style="color:#0d7c3d;">Action needed: re-upload documents</h2>
        <p>Hi ${escapeHtml(lead.name)},</p>
        <p>Our team reviewed your study abroad application for <strong>${escapeHtml(lead.country)}</strong>
        (${escapeHtml(lead.applyingCourse)}) and needs you to upload the following documents:</p>
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
      await logAdminActivity(
        req.admin,
        'REQUEST_STUDENT_REUPLOAD',
        `Requested Study Abroad doc re-upload from student ${lead.name} (Email failed)`,
        {
          leadId: lead._id,
          candidateName: lead.name,
          email: lead.email,
          subject: 'RouteUp — Please re-upload your study abroad documents',
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
      'REQUEST_STUDENT_REUPLOAD',
      `Requested Study Abroad doc re-upload from student ${lead.name}`,
      {
        leadId: lead._id,
        candidateName: lead.name,
        email: lead.email,
        subject: 'RouteUp — Please re-upload your study abroad documents',
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

// @desc    Resolve a document URL (Cloudinary). Migrates legacy /uploads paths when possible.
// @route   GET /api/study-abroad-leads/:id/document-url
// @access  Private
router.get('/:id/document-url', protect, async (req, res) => {
  let lead;
  let doc;
  try {
    const { title } = req.query;
    if (!title) {
      return res.status(400).json({ message: 'Document title is required' });
    }

    lead = await StudyAbroadLead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });

    doc = (lead.uploadedDocuments || []).find((d) => d.title === title);
    if (!doc?.filePath) {
      return res.status(404).json({ message: 'Document not found' });
    }

    const url = await resolveStoredFileUrl(doc.filePath, 'study-abroad-docs');
    if (url !== doc.filePath) {
      doc.filePath = url;
      lead.markModified('uploadedDocuments');
      await lead.save();
      socketHandler.emitStudyAbroadLeadUpdated(lead);
    }

    return res.json({
      url: doc.filePath,
      viewUrl: getDocumentViewUrl(doc.filePath),
      downloadUrl: getDocumentDownloadUrl(doc.filePath),
      isPdf: isPdfCloudinaryUrl(doc.filePath),
    });
  } catch (error) {
    console.error('Resolve study abroad document URL error:', error);

    if (lead && doc && isLocalUploadPath(doc.filePath)) {
      doc.needsReupload = true;
      doc.reuploadNote =
        doc.reuploadNote ||
        'Original file could not be found. Please upload this document again.';
      doc.filePath = '';
      lead.markModified('uploadedDocuments');
      await lead.save();
      socketHandler.emitStudyAbroadLeadUpdated(lead);
    }

    return res.status(404).json({ message: error.message || 'Document unavailable' });
  }
});

// @desc    Get single study abroad lead
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

    await logAdminActivity(
      req.admin,
      'UPDATE_STUDENT_LEAD',
      `Updated Student Study Abroad lead for ${lead.name}`,
      { leadId: lead._id, candidateName: lead.name, status: lead.status, applyingCourse: lead.applyingCourse }
    );

    socketHandler.emitStudyAbroadLeadUpdated(lead);

    res.json(lead);
  } catch (error) {
    console.error('Update study abroad lead error:', error);
    res.status(500).json({ message: 'Failed to update lead' });
  }
});

// @desc    Delete a specific uploaded document
// @route   DELETE /api/study-abroad-leads/:id/document
// @access  Private (Admin)
router.delete('/:id/document', protect, async (req, res) => {
  const { title } = req.body;
  if (!title) {
    return res.status(400).json({ message: 'Document title is required' });
  }

  try {
    const lead = await StudyAbroadLead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });

    const docIndex = (lead.uploadedDocuments || []).findIndex((d) => d.title === title);
    if (docIndex === -1) {
      return res.status(404).json({ message: 'Document not found' });
    }

    const doc = lead.uploadedDocuments[docIndex];
    if (doc.filePath) {
      await deleteFileIfExists(doc.filePath);
    }


    if (doc.needsReupload) {
      doc.fileName = '';
      doc.filePath = '';
    } else {
      lead.uploadedDocuments.splice(docIndex, 1);
    }

    lead.markModified('uploadedDocuments');
    await lead.save();

    try {
      socketHandler.emitStudyAbroadLeadUpdated(lead);
    } catch {
      /* ignore */
    }

    await logAdminActivity(
      req.admin,
      'DELETE_STUDENT_DOCUMENT',
      `Deleted document "${title}" for Student lead ${lead.name}`,
      { leadId: lead._id, candidateName: lead.name, documentTitle: title }
    );

    res.json({ message: 'Document deleted successfully', lead });
  } catch (error) {
    console.error('Delete study abroad document error:', error);
    res.status(500).json({ message: 'Failed to delete document' });
  }
});

// @desc    Delete lead
// @route   DELETE /api/study-abroad-leads/:id
// @access  Private
router.delete('/:id', protect, async (req, res) => {
  try {
    const lead = await StudyAbroadLead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });

    for (const doc of lead.uploadedDocuments || []) {
      await deleteFileIfExists(doc.filePath);
    }


    const studentName = lead.name;
    const leadId = lead._id.toString();
    await lead.deleteOne();

    await logAdminActivity(
      req.admin,
      'DELETE_STUDENT_LEAD',
      `Deleted Student Study Abroad lead for ${studentName}`,
      { leadId, candidateName: studentName }
    );

    socketHandler.emitStudyAbroadLeadDeleted(leadId);

    res.json({ message: 'Lead deleted', id: leadId });
  } catch (error) {
    console.error('Delete study abroad lead error:', error);
    res.status(500).json({ message: 'Failed to delete lead' });
  }
});

module.exports = router;
