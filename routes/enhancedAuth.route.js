const express = require('express');
const {
  registerUser,
  loginUser,
  googleAuth,
  getUserProfile,
  updateUserProfile,
  updateMemoryPreferences,
  getUserSessions,
  deleteAccount,
  authenticateToken
} = require('../controllers/enhancedAuth.controller');

const router = express.Router();

// Public routes
router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/google', googleAuth);

// Protected routes
router.use(authenticateToken); // Apply auth middleware to all routes below

router.get('/profile', getUserProfile);
router.put('/profile', updateUserProfile);
router.put('/memory-preferences', updateMemoryPreferences);
router.get('/sessions', getUserSessions);
router.delete('/account', deleteAccount);

module.exports = router;
