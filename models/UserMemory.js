const mongoose = require('mongoose');

const userMemorySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  summary: {
    type: String,
    default: '',
    maxlength: 5000
  },
  keyTopics: [{
    topic: String,
    frequency: { type: Number, default: 1 },
    lastMentioned: { type: Date, default: Date.now }
  }],
  userPreferences: {
    communicationStyle: {
      type: String,
      enum: ['formal', 'casual', 'technical', 'friendly'],
      default: 'casual'
    },
    responseLength: {
      type: String,
      enum: ['brief', 'moderate', 'detailed'],
      default: 'moderate'
    },
    expertise: [{
      domain: String,
      level: { type: String, enum: ['beginner', 'intermediate', 'advanced'] }
    }],
    interests: [String],
    languages: [String]
  },
  contextData: {
    recentProjects: [String],
    currentGoals: [String],
    learningTopics: [String],
    workContext: String,
    personalContext: String
  },
  embeddings: {
    type: [Number],
    default: undefined
  },
  conversationMetrics: {
    totalMessages: { type: Number, default: 0 },
    averageSessionLength: { type: Number, default: 0 },
    preferredTopics: [String],
    lastActiveDate: { type: Date, default: Date.now }
  },
  memoryVersion: {
    type: Number,
    default: 1
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for efficient lookups
userMemorySchema.index({ userId: 1 });
userMemorySchema.index({ 'keyTopics.topic': 1 });
userMemorySchema.index({ updatedAt: -1 });

// Update the updatedAt field on save
userMemorySchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Methods for managing memory
userMemorySchema.methods.addKeyTopic = function(topic) {
  const existingTopic = this.keyTopics.find(kt => kt.topic === topic);
  
  if (existingTopic) {
    existingTopic.frequency += 1;
    existingTopic.lastMentioned = new Date();
  } else {
    this.keyTopics.push({
      topic,
      frequency: 1,
      lastMentioned: new Date()
    });
  }
  
  // Keep only top 50 topics
  this.keyTopics.sort((a, b) => b.frequency - a.frequency);
  this.keyTopics = this.keyTopics.slice(0, 50);
};

userMemorySchema.methods.updateSummary = function(newSummary) {
  this.summary = newSummary;
  this.memoryVersion += 1;
  this.updatedAt = new Date();
};

userMemorySchema.methods.incrementMessageCount = function() {
  this.conversationMetrics.totalMessages += 1;
  this.conversationMetrics.lastActiveDate = new Date();
};

userMemorySchema.methods.addInterest = function(interest) {
  if (!this.userPreferences.interests.includes(interest)) {
    this.userPreferences.interests.push(interest);
  }
};

userMemorySchema.methods.getContextForAI = function() {
  return {
    summary: this.summary,
    keyTopics: this.keyTopics.slice(0, 10), // Top 10 topics
    preferences: this.userPreferences,
    context: this.contextData,
    metrics: {
      totalMessages: this.conversationMetrics.totalMessages,
      preferredTopics: this.conversationMetrics.preferredTopics
    }
  };
};

// Static methods
userMemorySchema.statics.findOrCreateUserMemory = async function(userId) {
  let memory = await this.findOne({ userId });
  
  if (!memory) {
    memory = new this({ userId });
    await memory.save();
  }
  
  return memory;
};

userMemorySchema.statics.generateSummaryPrompt = function(messages) {
  const recentMessages = messages.slice(-20); // Last 20 messages
  const userMessages = recentMessages.filter(msg => msg.role === 'user');
  
  return `Based on these recent user messages, generate a concise summary of the user's interests, goals, and conversation context:
  
${userMessages.map(msg => `- ${msg.message}`).join('\n')}

Focus on:
1. Key topics and interests
2. User's expertise level and learning goals
3. Communication style preferences
4. Current projects or objectives

Summary:`;
};

const UserMemory = mongoose.model('UserMemory', userMemorySchema);

module.exports = UserMemory;
