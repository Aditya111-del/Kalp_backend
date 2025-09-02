const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    // Connect to MongoDB (local instance)
    const conn = await mongoose.connect('mongodb://localhost:27017/kalp_ai', {
      // These options are no longer needed in newer versions of Mongoose
      // but kept for compatibility
    });

    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

module.exports = connectDB;
