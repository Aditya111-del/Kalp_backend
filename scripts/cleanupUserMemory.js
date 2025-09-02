const mongoose = require('mongoose');
const UserMemory = require('../models/UserMemory');
require('dotenv').config();

async function cleanupUserMemory() {
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        // Find all user memories with summaries longer than 4900 characters
        const longMemories = await UserMemory.find({
            $expr: { $gt: [{ $strLenCP: "$summary" }, 4900] }
        });

        console.log(`Found ${longMemories.length} user memories that need cleanup`);

        for (const memory of longMemories) {
            console.log(`Cleaning up memory for user ${memory.userId}`);
            console.log(`Original length: ${memory.summary.length}`);
            
            // Truncate to the last 4000 characters
            memory.summary = memory.summary.slice(-4000);
            memory.updatedAt = new Date();
            
            await memory.save();
            console.log(`New length: ${memory.summary.length}`);
        }

        console.log('Cleanup completed successfully!');
        process.exit(0);
    } catch (error) {
        console.error('Cleanup failed:', error);
        process.exit(1);
    }
}

cleanupUserMemory();
