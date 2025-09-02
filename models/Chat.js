const mongoose = require('mongoose');

// User Context Schema for persistent memory
const userContextSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true
  },
  name: String,
  preferences: {
    type: Map,
    of: String,
    default: {}
  },
  personalInfo: {
    type: Map,
    of: String,
    default: {}
  },
  conversationStyle: {
    type: String,
    enum: ['formal', 'casual', 'professional', 'friendly'],
    default: 'friendly'
  },
  topics: [{
    topic: String,
    frequency: Number,
    lastMentioned: Date
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Message Schema with enhanced context
const messageSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['user', 'ai', 'system'],
    required: true
  },
  content: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  isError: {
    type: Boolean,
    default: false
  },
  metadata: {
    model: String,
    tokens: Number,
    temperature: Number,
    contextUsed: Boolean
  },
  contextExtracted: {
    mentions: [String],
    entities: [String],
    sentiment: String,
    topics: [String]
  }
});

// Chat Session Schema with context integration
const chatSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    unique: true
  },
  userId: {
    type: String,
    required: true,
    default: 'anonymous'
  },
  title: {
    type: String,
    default: 'New Chat'
  },
  messages: [messageSchema],
  contextSnapshot: {
    userName: String,
    userPreferences: Map,
    sessionTopics: [String],
    conversationFlow: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  isActive: {
    type: Boolean,
    default: true
  }
});

// Middleware to update context and extract information
chatSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  
  // Auto-generate title from first user message if title is still "New Chat"
  if (this.title === 'New Chat' && this.messages.length > 0) {
    const firstUserMessage = this.messages.find(msg => msg.type === 'user');
    if (firstUserMessage) {
      // Take first 50 characters as title
      this.title = firstUserMessage.content.substring(0, 50) + (firstUserMessage.content.length > 50 ? '...' : '');
    }
  }
  
  // Extract context from recent messages
  if (this.messages.length > 0) {
    const recentMessages = this.messages.slice(-5); // Last 5 messages
    const topics = [];
    let userName = this.contextSnapshot?.userName;
    
    recentMessages.forEach(msg => {
      if (msg.type === 'user') {
        // Simple name extraction
        const nameMatch = msg.content.match(/(?:my name is|i am|i'm|call me)\s+([a-zA-Z]+)/i);
        if (nameMatch) {
          userName = nameMatch[1];
        }
        
        // Extract topics (simple keyword extraction)
        const words = msg.content.toLowerCase().split(/\s+/);
        const topicKeywords = words.filter(word => word.length > 4 && !['what', 'when', 'where', 'which', 'should', 'could', 'would'].includes(word));
        topics.push(...topicKeywords);
      }
    });
    
    this.contextSnapshot = {
      userName: userName || this.contextSnapshot?.userName,
      sessionTopics: [...new Set(topics)], // Remove duplicates
      conversationFlow: this.messages.length > 0 ? 'ongoing' : 'new'
    };
  }
  
  next();
});

const UserContext = mongoose.model('UserContext', userContextSchema);
const Chat = mongoose.model('Chat', chatSchema);

module.exports = { Chat, UserContext };
