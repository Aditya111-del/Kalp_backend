const mongoose = require('mongoose');

const chatHistorySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  sessionId: {
    type: String,
    required: true,
    index: true
  },
  role: {
    type: String,
    enum: ['user', 'assistant'],
    required: true
  },
  message: {
    type: String,
    required: true
  },
  messageType: {
    type: String,
    enum: ['text', 'code', 'system'],
    default: 'text'
  },
  metadata: {
    model: String,
    temperature: Number,
    maxTokens: Number,
    processingTime: Number,
    tokenCount: Number
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

// Compound indexes for efficient queries
chatHistorySchema.index({ userId: 1, timestamp: -1 });
chatHistorySchema.index({ userId: 1, sessionId: 1, timestamp: -1 });
chatHistorySchema.index({ sessionId: 1, timestamp: -1 });

// Static methods for common queries
chatHistorySchema.statics.getRecentMessages = function(userId, limit = 10) {
  return this.find({ userId })
    .sort({ timestamp: -1 })
    .limit(limit)
    .populate('userId', 'username email preferences');
};

chatHistorySchema.statics.getSessionHistory = function(userId, sessionId, limit = 50) {
  return this.find({ userId, sessionId })
    .sort({ timestamp: 1 })
    .limit(limit);
};

chatHistorySchema.statics.getUserSessions = function(userId) {
  return this.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(userId) } },
    { 
      $group: {
        _id: '$sessionId',
        lastMessage: { $last: '$message' },
        lastTimestamp: { $last: '$timestamp' },
        messageCount: { $sum: 1 }
      }
    },
    { $sort: { lastTimestamp: -1 } }
  ]);
};

chatHistorySchema.statics.cleanupOldMessages = function(days = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  
  return this.deleteMany({
    timestamp: { $lt: cutoffDate }
  });
};

const ChatHistory = mongoose.model('ChatHistory', chatHistorySchema);

module.exports = ChatHistory;
