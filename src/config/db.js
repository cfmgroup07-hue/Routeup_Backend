const dns = require('dns');
const mongoose = require('mongoose');

// Windows/local DNS often fails SRV lookups for mongodb+srv:// URIs.
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const connectDB = async () => {
  mongoose.connection.on('connected', () => {
    const { host, name } = mongoose.connection;
    console.log(`[MongoDB] connected → ${host} / db: ${name}`);
  });

  mongoose.connection.on('error', (error) => {
    console.error(`[MongoDB] connection error → ${error.message}`);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('[MongoDB] disconnected');
  });

  mongoose.connection.on('reconnected', () => {
    console.log('[MongoDB] reconnected');
  });

  try {
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI is missing from .env');
    }

    const conn = await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 15000,
    });

    return conn;
  } catch (error) {
    console.error(`[MongoDB] failed to connect → ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
