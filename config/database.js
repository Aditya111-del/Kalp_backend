const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    // Get MongoDB URI from environment variables
    const mongoURI = process.env.MONGODB_URI;
    
    if (!mongoURI) {
      throw new Error('MONGODB_URI environment variable is not set');
    }
    
    console.log('Attempting to connect to MongoDB Atlas...');
    console.log('MongoDB URI:', mongoURI.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@')); // Hide credentials in logs
    
    // Connect to MongoDB with modern options (compatible with MongoDB 4.0+)
    const conn = await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 10000, // 10 seconds timeout for server selection
      socketTimeoutMS: 45000, // 45 seconds socket timeout
      maxPoolSize: 10, // Maximum number of connections in connection pool
      minPoolSize: 2, // Minimum number of connections in connection pool
    });

    console.log(`✅ MongoDB Connected Successfully!`);
    console.log(`   Host: ${conn.connection.host}`);
    console.log(`   Database: ${conn.connection.name}`);
    console.log(`   Port: ${conn.connection.port}`);
    console.log(`   ReadyState: ${conn.connection.readyState}`);
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    console.error('Full error:', error);
    
    // Don't exit in production, let the app handle it gracefully
    if (process.env.NODE_ENV !== 'production') {
      console.log('Retrying connection in 5 seconds...');
      setTimeout(connectDB, 5000);
    } else {
      process.exit(1);
    }
  }
};

module.exports = connectDB;
