const express = require('express');
const chatController = require('../controllers/chat.controller.js');

const router = express.Router();

// Test endpoint
router.get('/test', (req, res) => {
    res.json({
        success: true,
        message: 'Chat API is working',
        model: process.env.MODEL,
        timestamp: new Date().toISOString()
    });
});

// Chat routes
router.post('/create', chatController.createChat);
router.post('/conversation', chatController.createConversation); // New route for conversation with history
router.delete('/delete', chatController.deleteChat);
router.put('/update', chatController.updateChat);
router.get('/get', chatController.getChat);
router.get('/models', chatController.getAvailableModels); // New route to get available models

module.exports = router;