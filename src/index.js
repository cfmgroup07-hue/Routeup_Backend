require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const connectDB = require('./config/db');
const socketHandler = require('./socket/socketHandler');
const Admin = require('./models/Admin');
const Service = require('./models/Service');
const VisaPathway = require('./models/VisaPathway');

// Initialize express & http server
const app = express();
const server = http.createServer(app);

// Define allowed origins
const clientUrl = process.env.CLIENT_URL || '*';

// Initialize Socket.io with CORS
const io = socketIo(server, {
  cors: {
    origin: clientUrl,
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

// Connect Database
connectDB();

// Seed Default Data
const seedData = async () => {
  try {
    // Seed Admin User
    const adminExists = await Admin.findOne({ email: 'admin@gmail.com' });
    if (!adminExists) {
      await Admin.create({
        email: 'admin@gmail.com',
        password: 'Admin@123'
      });
      console.log('Admin user seeded successfully: admin@gmail.com / Admin@123');
    } else {
      console.log('Admin user already exists in database');
    }

    // Seed Services
    const serviceWithNoKey = await Service.findOne({ key: { $exists: false } });
    if (serviceWithNoKey) {
      console.log('Detected old service schema. Clearing services...');
      await Service.deleteMany({});
    }

    const serviceCount = await Service.countDocuments();
    if (serviceCount === 0) {
      await Service.create([
        {
          title: 'Career Guidance',
          key: 'career',
          description: 'Personalized career mapping based on your education, skills & interests. We cover welding, electrical, HVAC, marine, offshore, aviation, healthcare & more.',
          price: 250,
          icon: '🎯'
        },
        {
          title: 'Visa & Migration',
          key: 'visa',
          description: 'Complete guidance on work visas, skilled migration pathways for Australia, Canada, UK, UAE, Germany & more. Document checklist & application roadmap.',
          price: 250,
          icon: '✈️'
        },
        {
          title: 'Job Placement Assist',
          key: 'placement',
          description: 'Resume building, interview preparation, and direct job referrals to our partner companies in India and overseas. We help you land the right job.',
          price: 250,
          icon: '💼'
        }
      ]);
      console.log('Default services seeded successfully');
    }

    // Seed Visa Pathways
    const pathwayWithNoCountry = await VisaPathway.findOne({ countryName: { $exists: false } });
    if (pathwayWithNoCountry) {
      console.log('Detected old visa pathway schema. Clearing pathways...');
      await VisaPathway.deleteMany({});
    }

    const pathwayCount = await VisaPathway.countDocuments();
    if (pathwayCount === 0) {
      await VisaPathway.create([
        {
          countryName: 'UAE / Dubai',
          countryFlag: '🇦🇪',
          visaTypes: ['Employment Visa', 'Green Visa'],
          description: 'Largest employer of Indian trade workers. Covers construction, oil & gas, hospitality, marine. Emigration clearance (ECR) required.',
          docBadgeText: 'Detailed visa document provided'
        },
        {
          countryName: 'Saudi Arabia',
          countryFlag: '🇸🇦',
          visaTypes: ['Work Visa', 'Iqama'],
          description: 'High demand for welding, electrical, HVAC, and construction trades. Requires attestation of documents from MEA and Saudi embassy.',
          docBadgeText: 'Detailed visa document provided'
        },
        {
          countryName: 'Australia',
          countryFlag: '🇦🇺',
          visaTypes: ['Subclass 482', 'Subclass 189'],
          description: 'Points-based skilled migration. Trades like welding, plumbing, electrical, and HVAC are on the Skilled Occupation List. Skills assessment required.',
          docBadgeText: 'Detailed visa document provided'
        },
        {
          countryName: 'Canada',
          countryFlag: '🇨🇦',
          visaTypes: ['Express Entry', 'PNP'],
          description: 'Federal Skilled Trades Program accepts welders, electricians, plumbers. CRS score-based system with provincial nomination pathways.',
          docBadgeText: 'Detailed visa document provided'
        },
        {
          countryName: 'Germany',
          countryFlag: '🇩🇪',
          visaTypes: ['Chancenkarte', 'Skilled Worker'],
          description: 'New Opportunity Card (Chancenkarte) allows trade workers to enter and job-search. German language (A2/B1) is an advantage.',
          docBadgeText: 'Detailed visa document provided'
        },
        {
          countryName: 'United Kingdom',
          countryFlag: '🇬🇧',
          visaTypes: ['Skilled Worker'],
          description: 'Sponsor-based work visa system. Trades on the Shortage Occupation List get reduced salary thresholds. Requires English test (IELTS).',
          docBadgeText: 'Detailed visa document provided'
        }
      ]);
      console.log('Default visa pathways seeded successfully');
    }
  } catch (error) {
    console.error('Error seeding database:', error);
  }
};
seedData();

// Middleware
app.use(cors({ origin: clientUrl }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve Uploaded Files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Socket.io Handler
socketHandler.init(io);

// Define Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/bookings', require('./routes/bookingRoutes'));
app.use('/api/services', require('./routes/serviceRoutes'));
app.use('/api/visa-pathways', require('./routes/visaRoutes'));
app.use('/api/payment', require('./routes/paymentRoutes'));


// Basic health check route
app.get('/', (req, res) => {
  res.send('RouteUp API is running...');
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: err.message || 'Server Error' });
});

// Port configuration
const PORT = process.env.PORT || 5000;

// Start server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
