const mongoose = require('mongoose');

const dropCollections = async () => {
  const mongoUri = 'mongodb://127.0.0.1:27017/routeup';
  try {
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB.');
    const db = mongoose.connection.db;
    
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);
    console.log('Existing collections:', collectionNames);

    if (collectionNames.includes('bookings')) {
      console.log('Dropping bookings collection...');
      await db.collection('bookings').drop();
    }
    
    if (collectionNames.includes('admins')) {
      console.log('Dropping admins collection...');
      await db.collection('admins').drop();
    }

    console.log('Collections dropped successfully.');
  } catch (error) {
    console.error('Failed to drop collections:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
    process.exit(0);
  }
};

dropCollections();
