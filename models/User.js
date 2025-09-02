const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 30
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  passwordHash: {
    type: String,
    required: function() {
      return !this.googleId; // Password required only if not Google user
    },
    minlength: 6
  },
  googleId: {
    type: String,
    unique: true,
    sparse: true // Allows null values while maintaining uniqueness
  },
  displayName: {
    type: String,
    trim: true
  },
  avatar: {
    type: String,
    default: null
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  verificationToken: String,
  resetPasswordToken: String,
  resetPasswordExpires: Date,
  preferences: {
    theme: {
      type: String,
      enum: ['light', 'dark'],
      default: 'dark'
    },
    aiTone: {
      type: String,
      enum: ['professional', 'casual', 'friendly', 'technical'],
      default: 'friendly'
    },
    language: {
      type: String,
      default: 'en'
    },
    notifications: {
      type: Boolean,
      default: true
    },
    privacy: {
      saveConversations: { type: Boolean, default: true },
      personalizeResponses: { type: Boolean, default: true },
      shareAnalytics: { type: Boolean, default: false }
    }
  },
  plan: {
    type: String,
    enum: ['free', 'premium', 'enterprise'],
    default: 'free'
  },
  usage: {
    messagesThisMonth: { type: Number, default: 0 },
    lastResetDate: { type: Date, default: Date.now },
    totalMessages: { type: Number, default: 0 }
  },
  lastLogin: {
    type: Date,
    default: Date.now
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for faster queries
userSchema.index({ email: 1 });
userSchema.index({ googleId: 1 });

// Hash password before saving
userSchema.pre('save', async function(next) {
  // Only hash password if it's modified and exists
  if (!this.isModified('passwordHash') || !this.passwordHash) {
    return next();
  }
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  if (!this.passwordHash) {
    return false; // No password set (Google user)
  }
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

// Get public profile (exclude sensitive data)
userSchema.methods.getPublicProfile = function() {
  const userObject = this.toObject();
  delete userObject.passwordHash;
  delete userObject.verificationToken;
  delete userObject.resetPasswordToken;
  delete userObject.resetPasswordExpires;
  return userObject;
};

// Update last login
userSchema.methods.updateLastLogin = function() {
  this.lastLogin = new Date();
  return this.save();
};

// Increment message usage
userSchema.methods.incrementUsage = function() {
  const now = new Date();
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastReset = new Date(this.usage.lastResetDate);
  
  // Reset monthly count if it's a new month
  if (lastReset < currentMonth) {
    this.usage.messagesThisMonth = 0;
    this.usage.lastResetDate = now;
  }
  
  this.usage.messagesThisMonth += 1;
  this.usage.totalMessages += 1;
  
  return this.save();
};

// Check if user can send more messages
userSchema.methods.canSendMessage = function() {
  const limits = {
    free: 100,
    premium: 1000,
    enterprise: Infinity
  };
  
  return this.usage.messagesThisMonth < limits[this.plan];
};

const User = mongoose.model('User', userSchema);

module.exports = User;
