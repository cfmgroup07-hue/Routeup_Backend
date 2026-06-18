const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Booking = require('../models/Booking');
const { protect } = require('../middleware/authMiddleware');
const { notifyNewBooking, notifyBookingUpdate } = require('../socket/socketHandler');
const { sendEmail } = require('../utils/mailer');

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
    if (ext === '.pdf' || ext === '.doc' || ext === '.docx') {
      cb(null, true);
    } else {
      cb(new Error('Only .pdf, .doc and .docx files are allowed!'));
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
        cvPath: req.file ? `/uploads/${req.file.filename}` : ''
      },
      notes: notes || '',
      amount: Number(amount),
      paymentStatus: 'Paid',
      paymentId: razorpay_payment_id
    };

    const booking = await Booking.create(bookingData);
    
    // Notify admin socket of pending booking
    notifyNewBooking(booking);

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
    res.json({ message: 'Meeting scheduled successfully', booking });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Post meeting upload notes and doc
// @route   POST /api/bookings/:id/post-meeting
// @access  Private (Admin)
router.post('/:id/post-meeting', protect, upload.single('document'), async (req, res) => {
  try {
    const { notes } = req.body;
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    const docPath = req.file ? `/uploads/${req.file.filename}` : '';
    booking.postMeetingDetails = {
      notes: notes || '',
      documentPath: docPath
    };
    await booking.save();

    // Send email to candidate
    const emailHtml = `
      <h2>RouteUp: Post-Session Summary & Documents</h2>
      <p>Hello ${booking.name},</p>
      <p>Thank you for attending the session with us. Here is the summary of our discussion:</p>
      <p><strong>Notes:</strong><br/>${notes}</p>
      <br/>
      ${docPath ? '<p>We have also attached a personalized document for you.</p>' : ''}
      <br/>
      <p>Excited to see where your career takes you.</p>
      <br/>
      <p>Best wishes!<br/>RouteUp Team</p>
    `;

    const attachments = [];
    if (docPath) {
      // The actual path on the server file system
      const absPath = path.join(__dirname, '../..', docPath);
      attachments.push({
        filename: req.file.originalname,
        path: absPath
      });
    }

    await sendEmail({
      to: booking.email,
      subject: 'RouteUp: Session Summary & Documents',
      htmlContent: emailHtml,
      attachments: attachments
    });

    notifyBookingUpdate(booking);
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

    await Booking.findByIdAndDelete(req.params.id);

    res.json({ message: 'Booking deleted successfully', id: req.params.id });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
