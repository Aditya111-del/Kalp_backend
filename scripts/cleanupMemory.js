require('dotenv').config();
const mongoose = require('mongoose');
const UserMemory = require('../models/UserMemory');

const cleanupUserMemory = async () => {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected successfully');

    // Find all user memories that exceed the limit
    const oversizedMemories = await UserMemory.find({
      $expr: { $gt: [{ $strLenCP: "$summary" }, 5000] }
    });

    console.log(`Found ${oversizedMemories.length} oversized memories`);

    for (const memory of oversizedMemories) {
      console.log(`Fixing memory for user ${memory.userId} (current length: ${memory.summary.length})`);
      
      // Truncate to 3000 characters to leave room for new content
      memory.summary = memory.summary.slice(-3000);
      memory.updatedAt = new Date();
      
      await memory.save();
      console.log(`✅ Fixed memory for user ${memory.userId} (new length: ${memory.summary.length})`);
    }

    console.log('✅ Memory cleanup completed successfully');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    process.exit(1);
  }
};

cleanupUserMemory();
