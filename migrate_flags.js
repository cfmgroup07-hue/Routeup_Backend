require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('./src/config/db');
const VisaPathway = require('./src/models/VisaPathway');

const emojiToCode = {
  '🇦🇪': 'ae', '🇦🇺': 'au', '🇨🇦': 'ca', '🇩🇪': 'de', '🇬🇧': 'gb', '🇳🇿': 'nz', 
  '🇸🇬': 'sg', '🇺🇸': 'us', '🇮🇳': 'in', '🇫🇷': 'fr', '🇮🇹': 'it', '🇯🇵': 'jp', 
  '🇶🇦': 'qa', '🇸🇦': 'sa', '🇴🇲': 'om', '🇰🇼': 'kw', '🇧🇭': 'bh'
};

// Also handle the case where they are already string abbreviations like 'AE', 'CA'
// we will just make sure they are lowercase.

const run = async () => {
  await connectDB();
  const pathways = await VisaPathway.find();
  
  for (let p of pathways) {
    let oldFlag = p.countryFlag;
    let newFlag = emojiToCode[oldFlag] || oldFlag.toLowerCase();
    
    // just in case we have spaces or weird characters
    newFlag = newFlag.trim();
    
    if (newFlag !== oldFlag) {
      console.log(`Updated pathway ${p.countryName}: flag ${oldFlag} -> ${newFlag}`);
      p.countryFlag = newFlag;
      await p.save();
    }
  }
  
  console.log('Flag Migration complete.');
  process.exit(0);
};

run();
