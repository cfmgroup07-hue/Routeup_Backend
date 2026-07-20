const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Booking = require('../models/Booking');
const Service = require('../models/Service');
const { protect } = require('../middleware/authMiddleware');
const { notifyNewBooking, notifyBookingUpdate } = require('../socket/socketHandler');
const { sendEmail } = require('../utils/mailer');
const { logAdminActivity } = require('../utils/activityLogger');
const { uploadToCloudinary, isCloudinaryUrl } = require('../utils/cloudinary');

const storeFileOnCloudinary = async (filePath, folder) => {
  const secureUrl = await uploadToCloudinary(filePath, folder);
  if (!isCloudinaryUrl(secureUrl)) {
    throw new Error('Uploaded file must be stored on Cloudinary');
  }
  return secureUrl;
};


// Ensure uploads folder exists
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer Config for CV Resume upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF (.pdf) files are allowed!'));
    }
  }
});


// @desc    Create a new booking request
// @route   POST /api/bookings
// @access  Public
router.post('/', upload.single('cv'), async (req, res) => {
  try {
    const {
      name,
      phone,
      email,
      age,
      address,
      education,
      currentStatus,
      skills,
      services,
      careerIndustry,
      careerJobTitle,
      preferredCountry,
      passport,
      overseasExp,
      placementIndustry,
      notes,
      amount,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    } = req.body;

    // Verify Payment Signature
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ message: 'Payment details are missing' });
    }

    const bodyToHash = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(bodyToHash.toString())
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ message: 'Invalid payment signature. Booking aborted.' });
    }

    let servicesArray = [];
    if (services) {
      servicesArray = typeof services === 'string' 
        ? services.split(',').map(s => s.trim()).filter(Boolean)
        : services;
    }

    const bookingData = {
      name,
      phone,
      email,
      age: Number(age),
      address,
      education,
      currentStatus,
      skills: skills || '',
      services: servicesArray,
      careerDetails: {
        industry: careerIndustry || '',
        position: careerJobTitle || ''
      },
      migrationDetails: {
        preferredCountry: preferredCountry || '',
        passportStatus: passport || '',
        overseasExperience: overseasExp || ''
      },
      placementDetails: {
        preferredIndustry: placementIndustry || '',
        cvPath: req.file ? await storeFileOnCloudinary(req.file.path, 'resumes') : ''
      },

      notes: notes || '',
      amount: Number(amount),
      paymentStatus: 'Paid',
      paymentId: razorpay_payment_id
    };

    const booking = await Booking.create(bookingData);
    
    // Notify admin socket of pending booking
    notifyNewBooking(booking);

    const dbServices = await Service.find({
      key: { $in: servicesArray.map((s) => s.toLowerCase().trim()) }
    });

    const selectedSessionsHtml = dbServices.length > 0
      ? dbServices.map((service) => {
          let sessionDetails = '';
          if (service.key === 'career' && (booking.careerDetails?.industry || booking.careerDetails?.position)) {
            sessionDetails = `
              <p style="margin: 8px 0 0; font-size: 14px; color: #475569;">
                ${booking.careerDetails.industry ? `<strong>Industry:</strong> ${booking.careerDetails.industry}<br/>` : ''}
                ${booking.careerDetails.position ? `<strong>Target Role:</strong> ${booking.careerDetails.position}` : ''}
              </p>`;
          }
          if (service.key === 'visa' && (booking.migrationDetails?.preferredCountry || booking.migrationDetails?.passportStatus)) {
            sessionDetails = `
              <p style="margin: 8px 0 0; font-size: 14px; color: #475569;">
                ${booking.migrationDetails.preferredCountry ? `<strong>Preferred Country:</strong> ${booking.migrationDetails.preferredCountry}<br/>` : ''}
                ${booking.migrationDetails.passportStatus ? `<strong>Passport Status:</strong> ${booking.migrationDetails.passportStatus}<br/>` : ''}
                ${booking.migrationDetails.overseasExperience ? `<strong>Overseas Experience:</strong> ${booking.migrationDetails.overseasExperience}` : ''}
              </p>`;
          }
          if (service.key === 'placement' && booking.placementDetails?.preferredIndustry) {
            sessionDetails = `
              <p style="margin: 8px 0 0; font-size: 14px; color: #475569;">
                <strong>Preferred Industry:</strong> ${booking.placementDetails.preferredIndustry}
              </p>`;
          }

          return `
            <div style="border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; margin-bottom: 12px; background: #ffffff;">
              <p style="margin: 0 0 6px; font-size: 16px; font-weight: 700; color: #0f172a;">${service.title}</p>
              <p style="margin: 0 0 8px; font-size: 14px; line-height: 1.5; color: #64748b;">${service.description}</p>
              <p style="margin: 0; font-size: 14px;"><strong>Session Fee:</strong> Rs.${service.price} <span style="color: #64748b;">(60 min advisory session)</span></p>
              ${sessionDetails}
            </div>`;
        }).join('')
      : servicesArray.map((key) => `
          <div style="border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; margin-bottom: 12px;">
            <p style="margin: 0; font-size: 16px; font-weight: 700; color: #0f172a;">${key}</p>
          </div>`).join('');

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
        <div style="background-color: #0d7c3d; color: #fff; padding: 20px; text-align: center;">
          <h2 style="margin: 0; font-size: 24px;">Payment Successful</h2>
          <p style="margin: 8px 0 0; font-size: 14px; opacity: 0.95;">Your RouteUp session booking is confirmed</p>
        </div>
        <div style="padding: 30px;">
          <p style="font-size: 16px;">Dear <strong>${booking.name}</strong>,</p>
          <p style="font-size: 16px; line-height: 1.6;">Thank you for choosing RouteUp. We are pleased to confirm that your payment has been received successfully and your advisory session request is now confirmed.</p>

          <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; padding: 18px; margin: 25px 0; border-radius: 10px;">
            <p style="margin: 0 0 14px 0; font-size: 13px; color: #166534; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;">Selected Session(s)</p>
            ${selectedSessionsHtml}
          </div>

          <div style="background-color: #f8fafc; border-left: 4px solid #0d7c3d; padding: 18px; margin: 25px 0; border-radius: 0 8px 8px 0;">
            <p style="margin: 0 0 12px 0; font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;">Payment Summary</p>
            <p style="margin: 0 0 8px 0; font-size: 15px;"><strong>Total Amount Paid:</strong> Rs.${booking.amount}</p>
            <p style="margin: 0 0 8px 0; font-size: 15px;"><strong>Payment ID:</strong> ${booking.paymentId}</p>
            <p style="margin: 0; font-size: 15px;"><strong>Registered Email:</strong> ${booking.email}</p>
          </div>

          <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 18px; margin: 25px 0; border-radius: 0 8px 8px 0;">
            <p style="margin: 0 0 8px 0; font-size: 15px; font-weight: 700; color: #1e40af;">What happens next?</p>
            <p style="margin: 0; font-size: 15px; line-height: 1.6; color: #334155;">Our admin team will review your request and connect with you within <strong>24 hours</strong> to schedule your session and share further details.</p>
          </div>

          <p style="font-size: 15px; line-height: 1.6; color: #475569;">If you have any urgent questions, feel free to reply to this email or contact us at <a href="mailto:hello@routeup.co.in" style="color: #0d7c3d; text-decoration: none; font-weight: 600;">hello@routeup.co.in</a>.</p>

          <p style="font-size: 16px; margin-top: 30px; line-height: 1.5;">We look forward to guiding you on your career journey.</p>

          <p style="font-size: 15px; color: #64748b; margin-top: 28px;">
            Warm regards,<br/>
            <strong style="color: #0f172a;">The RouteUp Team</strong><br/>
            <span style="font-size: 13px;">Career Advisory & Migration Guidance</span>
          </p>
        </div>
        <div style="background-color: #f1f5f9; padding: 15px; text-align: center; font-size: 12px; color: #64748b;">
          &copy; ${new Date().getFullYear()} RouteUp. All rights reserved.
        </div>
      </div>
    `;

    try {
      await sendEmail({
        to: booking.email,
        subject: 'RouteUp: Payment Successful — We Will Connect Within 24 Hours',
        htmlContent: emailHtml,
      });
    } catch (emailError) {
      console.error('Booking confirmation email failed:', emailError);
    }

    res.status(201).json(booking);
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: error.message });
  }
});

// @desc    Confirm payment for a booking
// @route   POST /api/bookings/:id/pay
// @access  Public
router.post('/:id/pay', async (req, res) => {
  try {
    const { paymentId } = req.body;
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    booking.paymentStatus = 'Paid';
    booking.paymentId = paymentId || `pay_mock_${Date.now()}`;
    await booking.save();

    // Broadcast update via socket
    notifyBookingUpdate(booking);

    res.json({ message: 'Payment confirmed successfully', booking });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Get all bookings (Admin protected)
// @route   GET /api/bookings
// @access  Private (Admin)
router.get('/', protect, async (req, res) => {
  try {
    const { status, paymentStatus, service } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (paymentStatus) filter.paymentStatus = paymentStatus;
    if (service) filter.services = service;

    const bookings = await Booking.find(filter).sort({ createdAt: -1 });
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Get single booking (Admin protected)
// @route   GET /api/bookings/:id
// @access  Private (Admin)
router.get('/:id', protect, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }
    res.json(booking);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Update booking details e.g. status or notes (Admin protected)
// @route   PUT /api/bookings/:id
// @access  Private (Admin)
router.put('/:id', protect, async (req, res) => {
  try {
    const { 
      status, 
      counselorNotes,
      name,
      phone,
      email,
      age,
      address,
      education,
      currentStatus,
      skills
    } = req.body;
    
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    if (status) booking.status = status;
    if (counselorNotes !== undefined) booking.counselorNotes = counselorNotes;
    
    // Update candidate profile if provided
    if (name) booking.name = name;
    if (phone) booking.phone = phone;
    if (email) booking.email = email;
    if (age) booking.age = age;
    if (address) booking.address = address;
    if (education) booking.education = education;
    if (currentStatus) booking.currentStatus = currentStatus;
    if (skills !== undefined) booking.skills = skills;

    await booking.save();

    // Notify admin socket of status/notes change
    notifyBookingUpdate(booking);

    await logAdminActivity(
      req.admin,
      'UPDATE_BOOKING',
      `Updated candidate booking for ${booking.name}. Status: ${booking.status}`,
      { bookingId: booking._id, candidateName: booking.name, status: booking.status, counselorNotes }
    );

    res.json(booking);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Schedule meeting for a booking
// @route   POST /api/bookings/:id/schedule
// @access  Private (Admin)
router.post('/:id/schedule', protect, async (req, res) => {
  try {
    const { link, dateTime } = req.body;
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    booking.meetingDetails = { link, dateTime };
    booking.status = 'Processing'; // Move to processing if scheduled
    await booking.save();

    // Format Date and Time
    const d = new Date(dateTime);
    const formattedDate = d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const formattedTime = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

    // Send email to candidate
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
        <div style="background-color: #0d7c3d; color: #fff; padding: 15px; text-align: center;">
          <h2 style="margin: 0; font-size: 22px;">Your Session is Scheduled!</h2>
        </div>
        <div style="padding: 30px;">
          <p style="font-size: 16px;">Hello <strong>${booking.name}</strong>,</p>
          <p style="font-size: 16px; line-height: 1.5;">Great news! Your career advisory session with the RouteUp team has been successfully scheduled.</p>
          
          <div style="background-color: #f8fafc; border-left: 4px solid #0d7c3d; padding: 15px; margin: 25px 0;">
            <p style="margin: 0 0 10px 0; font-size: 16px;"><strong>📅 Date:</strong> ${formattedDate}</p>
            <p style="margin: 0 0 10px 0; font-size: 16px;"><strong>⏰ Time:</strong> ${formattedTime}</p>
            <p style="margin: 0; font-size: 16px;"><strong>🔗 Meeting Link:</strong> <a href="${link}" style="color: #0d7c3d; text-decoration: none; font-weight: bold;">Click here to join</a></p>
          </div>
          
          <p style="font-size: 16px; line-height: 1.5;">Please try to join the meeting 5 minutes early to ensure your audio and video are working properly. If you need to reschedule, please reply to this email.</p>
          
          <p style="font-size: 16px; margin-top: 30px;">We look forward to helping you achieve your career goals!</p>
          
          <p style="font-size: 16px; color: #666; margin-top: 30px;">
            Best regards,<br/>
            <strong>The RouteUp Team</strong>
          </p>
        </div>
        <div style="background-color: #f1f5f9; padding: 15px; text-align: center; font-size: 12px; color: #64748b;">
          &copy; ${new Date().getFullYear()} RouteUp. All rights reserved.
        </div>
      </div>
    `;

    await sendEmail({
      to: booking.email,
      subject: 'RouteUp: Your Session is Scheduled',
      htmlContent: emailHtml,
    });

    notifyBookingUpdate(booking);

    await logAdminActivity(
      req.admin,
      'SCHEDULE_MEETING',
      `Scheduled meeting with ${booking.name} on ${formattedDate} at ${formattedTime}`,
      {
        bookingId: booking._id,
        candidateName: booking.name,
        email: booking.email,
        subject: 'RouteUp: Your Session is Scheduled',
        dateTime,
        link,
        isEmail: true
      }
    );

    res.json({ message: 'Meeting scheduled successfully', booking });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Post meeting upload notes and documents
// @route   POST /api/bookings/:id/post-meeting
// @access  Private (Admin)
router.post('/:id/post-meeting', protect, upload.array('documents', 10), async (req, res) => {
  try {
    const { notes } = req.body;
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    if (!notes?.trim() && (!req.files || req.files.length === 0)) {
      return res.status(400).json({ message: 'Please add session notes or upload at least one file.' });
    }

    const uploadedPaths = [];
    const attachments = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        // Read bytes before Cloudinary upload deletes the temp file.
        // Nodemailer must NOT fetch public Cloudinary PDF URLs (account returns 401).
        const content = fs.readFileSync(file.path);
        attachments.push({
          filename: file.originalname,
          content,
          contentType: file.mimetype || 'application/pdf',
        });
        const secureUrl = await storeFileOnCloudinary(file.path, 'booking-docs');
        uploadedPaths.push(secureUrl);
      }
    }
    const existingPaths = booking.postMeetingDetails?.documentPaths || [];
    const documentPaths = [...existingPaths, ...uploadedPaths];

    booking.postMeetingDetails = {
      notes: notes?.trim() || booking.postMeetingDetails?.notes || '',
      documentPath: documentPaths[0] || booking.postMeetingDetails?.documentPath || '',
      documentPaths
    };
    await booking.save();


    const formattedNotes = (notes || booking.postMeetingDetails.notes || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br/>');

    const attachmentListHtml = (req.files || []).length > 0
      ? `<ul style="margin: 0; padding-left: 20px;">${req.files.map((file) => `<li style="margin-bottom: 6px;">${file.originalname}</li>`).join('')}</ul>`
      : '<p style="margin: 0;">No new files attached in this email.</p>';

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
        <div style="background-color: #0d7c3d; color: #fff; padding: 15px; text-align: center;">
          <h2 style="margin: 0; font-size: 22px;">Your Session Summary is Ready</h2>
        </div>
        <div style="padding: 30px;">
          <p style="font-size: 16px;">Hello <strong>${booking.name}</strong>,</p>
          <p style="font-size: 16px; line-height: 1.5;">Thank you for completing your RouteUp advisory session. Please find your session summary and shared documents below.</p>

          <div style="background-color: #f8fafc; border-left: 4px solid #0d7c3d; padding: 15px; margin: 25px 0;">
            <p style="margin: 0 0 10px 0; font-size: 14px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;"><strong>Session Notes</strong></p>
            <p style="margin: 0; font-size: 16px; line-height: 1.6;">${formattedNotes || 'Your counselor has shared follow-up documents with you.'}</p>
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

    await sendEmail({
      to: booking.email,
      subject: 'RouteUp: Your Session Summary & Documents',
      htmlContent: emailHtml,
      attachments
    });

    notifyBookingUpdate(booking);

    await logAdminActivity(
      req.admin,
      'SEND_POST_MEETING_EMAIL',
      `Sent post-meeting session summary to candidate ${booking.name}`,
      {
        bookingId: booking._id,
        candidateName: booking.name,
        email: booking.email,
        subject: 'RouteUp: Your Session Summary & Documents',
        notes: notes || '',
        attachments: (req.files || []).map(f => f.originalname),
        isEmail: true
      }
    );

    res.json({ message: 'Post-meeting details saved and email sent', booking });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Mark booking as completed
// @route   PUT /api/bookings/:id/complete
// @access  Private (Admin)
router.put('/:id/complete', protect, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    booking.status = 'Completed';
    await booking.save();

    notifyBookingUpdate(booking);

    await logAdminActivity(
      req.admin,
      'COMPLETE_BOOKING',
      `Marked booking for ${booking.name} as Completed`,
      { bookingId: booking._id, candidateName: booking.name }
    );

    res.json({ message: 'Booking marked as completed', booking });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Delete a booking
// @route   DELETE /api/bookings/:id
// @access  Private (Admin)
router.delete('/:id', protect, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    const candidateName = booking.name;
    await Booking.findByIdAndDelete(req.params.id);

    await logAdminActivity(
      req.admin,
      'DELETE_BOOKING',
      `Deleted booking for candidate ${candidateName}`,
      { bookingId: req.params.id, candidateName }
    );

    res.json({ message: 'Booking deleted successfully', id: req.params.id });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
