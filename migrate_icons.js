require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('./src/config/db');
const Service = require('./src/models/Service');

const run = async () => {
  await connectDB();
  const services = await Service.find();
  
  for (let s of services) {
    let changed = false;
    if (s.icon.includes('🎯')) {
      s.icon = 'Target';
      changed = true;
    } else if (s.icon.includes('✈')) {
      s.icon = 'Plane';
      changed = true;
    } else if (s.icon.includes('💼')) {
      s.icon = 'Briefcase';
      changed = true;
    }
    
    if (changed) {
      console.log(`Updated ${s.title} to use icon ${s.icon}`);
      await s.save();
    }
  }
  
  console.log('Migration complete.');
  process.exit(0);
};

run();
