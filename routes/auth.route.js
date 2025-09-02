const express = require('express');
const router = express.Router();
const {
  registerUser,
  loginUser,
  googleAuth,
  getUserProfile,
  updateUserProfile,
  authenticateToken
} = require('../controllers/auth.controller');

// Public routes
router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/google-auth', googleAuth);

// Protected routes (require authentication)
router.get('/profile', authenticateToken, getUserProfile);
router.put('/profile', authenticateToken, updateUserProfile);

// Logout (client-side token removal, but we can track it server-side if needed)
router.post('/logout', authenticateToken, (req, res) => {
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

module.exports = router;
