require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const connectDB = require('./config/db');
const socketHandler = require('./socket/socketHandler');
const { printStartupReport } = require('./utils/startupLogger');
const { migrateLocalUploadsToCloudinary } = require('./utils/migrateLocalUploads');
const Admin = require('./models/Admin');
const Service = require('./models/Service');
const VisaPathway = require('./models/VisaPathway');

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is missing from environment variables. Admin auth will not work.');
  process.exit(1);
}

// Initialize express & http server
const app = express();
const server = http.createServer(app);

// Define allowed origins (comma-separated CLIENT_URL + production defaults)
const defaultOrigins = [
  'https://routeup.co.in',
  'https://www.routeup.co.in',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];
const envOrigins = (process.env.CLIENT_URL || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const allowedOrigins = [...new Set([...envOrigins, ...defaultOrigins])];

const corsOrigin = (origin, callback) => {
  // Allow same-origin / non-browser tools (no Origin header)
  if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
    return callback(null, true);
  }
  return callback(new Error(`CORS blocked for origin: ${origin}`));
};

// Initialize Socket.io with CORS
const io = socketIo(server, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

// Connect Database & start server
const startServer = async () => {
  await connectDB();
  await seedData();
  await migrateLocalUploadsToCloudinary();

  socketHandler.init(io);

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`[HTTP Server] port ${PORT} is already in use`);
    } else {
      console.error(`[HTTP Server] failed to start → ${error.message}`);
    }
    process.exit(1);
  });

  server.listen(PORT, async () => {
    await printStartupReport({ port: PORT, allowedOrigins, io });
  });
};

// Seed Default Data
const seedData = async () => {
  try {
    // Seed Admin User
    const adminExists = await Admin.findOne({ email: 'admin@gmail.com' });
    if (!adminExists) {
      await Admin.create({
        name: 'Admin',
        email: 'admin@gmail.com',
        password: 'Admin@123',
        role: 'admin'
      });
      console.log('[Seed] Admin user seeded: admin@gmail.com');
    } else {
      let adminModified = false;
      if (!adminExists.name) {
        adminExists.name = 'Admin';
        adminModified = true;
      }
      if (adminExists.role !== 'admin') {
        adminExists.role = 'admin';
        adminModified = true;
      }
      if (adminModified) {
        await adminExists.save();
      }
      console.log('[Seed] Admin user already exists');
    }

    // Seed Super Admin User
    const superAdminExists = await Admin.findOne({ email: 'superadmin@gmail.com' });
    if (!superAdminExists) {
      await Admin.create({
        name: 'Super Admin',
        email: 'superadmin@gmail.com',
        password: 'Superadmin@123',
        role: 'superadmin'
      });
      console.log('[Seed] Super Admin user seeded: superadmin@gmail.com');
    } else {
      let superModified = false;
      if (superAdminExists.role !== 'superadmin') {
        superAdminExists.role = 'superadmin';
        superModified = true;
      }
      if (superModified) {
        await superAdminExists.save();
      }
      console.log('[Seed] Super Admin user already exists');
    }

    // Seed Services
    const serviceWithNoKey = await Service.findOne({ key: { $exists: false } });
    if (serviceWithNoKey) {
      console.log('[Seed] Cleared old service schema');
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
      console.log('[Seed] Default services seeded');
    }

    // Seed Visa Pathways
    const pathwayWithNoCountry = await VisaPathway.findOne({ countryName: { $exists: false } });
    if (pathwayWithNoCountry) {
      console.log('[Seed] Cleared old visa pathway schema');
      await VisaPathway.deleteMany({});
    }

    const pathwayCount = await VisaPathway.countDocuments();
    if (pathwayCount === 0) {
      await VisaPathway.create([
        {
          countryName: 'UAE / Dubai',
          countryFlag: 'ae',
          visaTypes: ['Employment Visa', 'Green Visa'],
          description: 'Largest employer of Indian trade workers. Covers construction, oil & gas, hospitality, marine. Emigration clearance (ECR) required.',
          docBadgeText: 'Detailed visa document provided'
        },
        {
          countryName: 'Saudi Arabia',
          countryFlag: 'sa',
          visaTypes: ['Work Visa', 'Iqama'],
          description: 'High demand for welding, electrical, HVAC, and construction trades. Requires attestation of documents from MEA and Saudi embassy.',
          docBadgeText: 'Detailed visa document provided'
        },
        {
          countryName: 'Australia',
          countryFlag: 'au',
          visaTypes: ['Subclass 482', 'Subclass 189'],
          description: 'Points-based skilled migration. Trades like welding, plumbing, electrical, and HVAC are on the Skilled Occupation List. Skills assessment required.',
          docBadgeText: 'Detailed visa document provided'
        },
        {
          countryName: 'Canada',
          countryFlag: 'ca',
          visaTypes: ['Express Entry', 'PNP'],
          description: 'Federal Skilled Trades Program accepts welders, electricians, plumbers. CRS score-based system with provincial nomination pathways.',
          docBadgeText: 'Detailed visa document provided'
        },
        {
          countryName: 'Germany',
          countryFlag: 'de',
          visaTypes: ['Chancenkarte', 'Skilled Worker'],
          description: 'New Opportunity Card (Chancenkarte) allows trade workers to enter and job-search. German language (A2/B1) is an advantage.',
          docBadgeText: 'Detailed visa document provided'
        },
        {
          countryName: 'United Kingdom',
          countryFlag: 'gb',
          visaTypes: ['Skilled Worker'],
          description: 'Sponsor-based work visa system. Trades on the Shortage Occupation List get reduced salary thresholds. Requires English test (IELTS).',
          docBadgeText: 'Detailed visa document provided'
        }
      ]);
      console.log('[Seed] Default visa pathways seeded');
    }
  } catch (error) {
    console.error('[Seed] Error seeding database:', error.message);
  }
};

// Middleware
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Serve Uploaded Files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Define Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/bookings', require('./routes/bookingRoutes'));
app.use('/api/services', require('./routes/serviceRoutes'));
app.use('/api/visa-pathways', require('./routes/visaRoutes'));
app.use('/api/payment', require('./routes/paymentRoutes'));
app.use('/api/pr-leads', require('./routes/prLeadRoutes'));
app.use('/api/study-abroad-leads', require('./routes/studyAbroadLeadRoutes'));
app.use('/api/university-leads', require('./routes/universityLeadRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));


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

startServer().catch((error) => {
  console.error('[Startup] Fatal error:', error.message);
  process.exit(1);
});
