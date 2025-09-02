const User = require('../models/User');
const UserMemory = require('../models/UserMemory');
const ChatHistory = require('../models/ChatHistory');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// JWT Secret (in production, use environment variable)
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRE = '7d';

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRE });
};

// Register user
const registerUser = async (req, res) => {
  try {
    const { username, email, password, confirmPassword, displayName } = req.body;

    // Validation
    if (!username || !email || !password || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required'
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    if (username.length < 3) {
      return res.status(400).json({
        success: false,
        message: 'Username must be at least 3 characters long'
      });
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid email address'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email: email.toLowerCase().trim() }, { username: username.trim() }]
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: existingUser.email === email.toLowerCase().trim() ? 
          'User with this email already exists' : 'Username is already taken'
      });
    }

    // Create user
    const user = new User({
      username: username.trim(),
      email: email.toLowerCase().trim(),
      passwordHash: password,
      displayName: displayName?.trim() || username.trim(),
      verificationToken: crypto.randomBytes(32).toString('hex')
    });

    await user.save();

    // Create initial user memory
    const userMemory = new UserMemory({
      userId: user._id,
      summary: 'New user - no conversation history yet.',
      userPreferences: {
        communicationStyle: 'casual',
        responseLength: 'moderate'
      },
      contextData: {
        recentProjects: [],
        currentGoals: [],
        learningTopics: []
      }
    });

    await userMemory.save();

    // Generate token
    const token = generateToken(user._id);

    // Set last login
    await user.updateLastLogin();

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token,
      user: user.getPublicProfile()
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Login user
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // Find user
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Account is deactivated. Please contact support.'
      });
    }

    // Check password
    const isPasswordCorrect = await user.comparePassword(password);
    if (!isPasswordCorrect) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Ensure user memory exists
    await UserMemory.findOrCreateUserMemory(user._id);

    // Generate token
    const token = generateToken(user._id);

    // Update last login
    await user.updateLastLogin();

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: user.getPublicProfile()
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Google OAuth login/register
const googleAuth = async (req, res) => {
  try {
    const { googleId, email, displayName, avatar } = req.body;

    if (!googleId || !email || !displayName) {
      return res.status(400).json({
        success: false,
        message: 'Google authentication data is incomplete'
      });
    }

    // Check if user exists with Google ID
    let user = await User.findOne({ googleId });

    if (!user) {
      // Check if user exists with email (link accounts)
      user = await User.findOne({ email: email.toLowerCase().trim() });
      
      if (user) {
        // Link Google account to existing user
        user.googleId = googleId;
        user.displayName = displayName;
        user.avatar = avatar || user.avatar;
        await user.save();
      } else {
        // Create new user
        const username = email.split('@')[0] + Math.floor(Math.random() * 1000);
        
        user = new User({
          username,
          email: email.toLowerCase().trim(),
          displayName: displayName.trim(),
          googleId,
          avatar,
          isVerified: true // Google users are automatically verified
        });
        await user.save();

        // Create initial user memory
        const userMemory = new UserMemory({
          userId: user._id,
          summary: 'New user registered via Google - no conversation history yet.',
          userPreferences: {
            communicationStyle: 'casual',
            responseLength: 'moderate'
          }
        });

        await userMemory.save();
      }
    } else {
      // Update user info if needed
      user.displayName = displayName.trim();
      user.email = email.toLowerCase().trim();
      user.avatar = avatar || user.avatar;
      await user.save();
    }

    // Ensure user memory exists
    await UserMemory.findOrCreateUserMemory(user._id);

    // Generate token
    const token = generateToken(user._id);

    // Update last login
    await user.updateLastLogin();

    res.json({
      success: true,
      message: 'Google authentication successful',
      token,
      user: user.getPublicProfile()
    });

  } catch (error) {
    console.error('Google auth error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get user profile with context
const getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get user memory and stats
    const userMemory = await UserMemory.findOne({ userId: req.userId });
    const totalMessages = await ChatHistory.countDocuments({ userId: req.userId });
    const sessions = await ChatHistory.getUserSessions(req.userId);

    res.json({
      success: true,
      user: user.getPublicProfile(),
      stats: {
        totalMessages,
        totalSessions: sessions.length,
        messagesThisMonth: user.usage.messagesThisMonth,
        canSendMessage: user.canSendMessage()
      },
      memory: userMemory ? {
        summary: userMemory.summary,
        keyTopics: userMemory.keyTopics.slice(0, 5),
        preferences: userMemory.userPreferences
      } : null
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Update user profile
const updateUserProfile = async (req, res) => {
  try {
    const updates = req.body;
    const allowedUpdates = ['displayName', 'preferences', 'avatar'];
    const actualUpdates = {};

    // Filter allowed updates
    Object.keys(updates).forEach(update => {
      if (allowedUpdates.includes(update)) {
        actualUpdates[update] = updates[update];
      }
    });

    const user = await User.findByIdAndUpdate(
      req.userId,
      actualUpdates,
      { new: true, runValidators: true }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: user.getPublicProfile()
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Update user memory preferences
const updateMemoryPreferences = async (req, res) => {
  try {
    const { communicationStyle, responseLength, interests, expertise } = req.body;

    let userMemory = await UserMemory.findOne({ userId: req.userId });
    if (!userMemory) {
      userMemory = await UserMemory.findOrCreateUserMemory(req.userId);
    }

    // Update preferences
    if (communicationStyle) userMemory.userPreferences.communicationStyle = communicationStyle;
    if (responseLength) userMemory.userPreferences.responseLength = responseLength;
    if (interests) userMemory.userPreferences.interests = interests;
    if (expertise) userMemory.userPreferences.expertise = expertise;

    await userMemory.save();

    res.json({
      success: true,
      message: 'Memory preferences updated successfully',
      preferences: userMemory.userPreferences
    });

  } catch (error) {
    console.error('Update memory preferences error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get user's chat sessions
const getUserSessions = async (req, res) => {
  try {
    const sessions = await ChatHistory.getUserSessions(req.userId);
    
    res.json({
      success: true,
      sessions
    });

  } catch (error) {
    console.error('Get user sessions error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Delete user account
const deleteAccount = async (req, res) => {
  try {
    const { password } = req.body;

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Verify password for non-Google users
    if (user.passwordHash && password) {
      const isValidPassword = await user.comparePassword(password);
      if (!isValidPassword) {
        return res.status(401).json({
          success: false,
          message: 'Invalid password'
        });
      }
    }

    // Delete user data
    await Promise.all([
      User.findByIdAndDelete(req.userId),
      UserMemory.findOneAndDelete({ userId: req.userId }),
      ChatHistory.deleteMany({ userId: req.userId })
    ]);

    res.json({
      success: true,
      message: 'Account deleted successfully'
    });

  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Middleware to verify JWT token
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token required'
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    
    // Check if user still exists and is active
    const user = await User.findById(decoded.userId);
    
    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }

    req.user = user; // Add user to request for convenience
    next();
  } catch (error) {
    console.error('Token verification error:', error.message);
    res.status(401).json({
      success: false,
      message: 'Invalid or expired token'
    });
  }
};

// Middleware to check usage limits
const checkUsageLimit = async (req, res, next) => {
  try {
    const user = req.user || await User.findById(req.userId);
    
    if (!user.canSendMessage()) {
      return res.status(429).json({
        success: false,
        message: 'Monthly message limit reached. Please upgrade your plan.',
        usage: {
          current: user.usage.messagesThisMonth,
          limit: user.plan === 'free' ? 100 : user.plan === 'premium' ? 1000 : 'unlimited'
        }
      });
    }

    next();
  } catch (error) {
    console.error('Usage limit check error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

module.exports = {
  registerUser,
  loginUser,
  googleAuth,
  getUserProfile,
  updateUserProfile,
  updateMemoryPreferences,
  getUserSessions,
  deleteAccount,
  authenticateToken,
  checkUsageLimit
};
