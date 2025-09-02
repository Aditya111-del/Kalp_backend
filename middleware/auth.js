const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

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
    console.error('Token verification error:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid or expired token'
    });
  }
};

// Middleware to check if user is admin
const requireAdmin = async (req, res, next) => {
  try {
    const user = req.user || await User.findById(req.userId);
    
    if (!user || user.plan !== 'enterprise') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    next();
  } catch (error) {
    console.error('Admin check error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
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
  authenticateToken,
  requireAdmin,
  checkUsageLimit
};
