const express = require('express');
const {
  sendMessage,
  getChatHistory,
  getUserSessions,
  deleteSession
} = require('../controllers/enhancedChat.controller');
const { authenticateToken, checkUsageLimit } = require('../controllers/enhancedAuth.controller');

const router = express.Router();

// Apply auth middleware to all routes
router.use(authenticateToken);

// Chat endpoints
router.post('/send', checkUsageLimit, sendMessage);
router.get('/history', getChatHistory);
router.get('/sessions', getUserSessions);
router.delete('/session/:sessionId', deleteSession);

module.exports = router;
