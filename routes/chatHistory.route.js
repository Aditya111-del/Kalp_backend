const express = require('express');
const router = express.Router();
const { Chat, UserContext } = require('../models/Chat');
const { v4: uuidv4 } = require('uuid');

// Get all chat sessions (for sidebar)
router.get('/sessions', async (req, res) => {
  try {
    const sessions = await Chat.find({})
      .select('sessionId title createdAt updatedAt')
      .sort({ updatedAt: -1 });
    
    res.json({
      success: true,
      sessions
    });
  } catch (error) {
    console.error('Error fetching chat sessions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch chat sessions'
    });
  }
});

// Get specific chat session with messages
router.get('/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const chat = await Chat.findOne({ sessionId });
    
    if (!chat) {
      return res.status(404).json({
        success: false,
        error: 'Chat session not found'
      });
    }
    
    res.json({
      success: true,
      chat
    });
  } catch (error) {
    console.error('Error fetching chat session:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch chat session'
    });
  }
});

// Create new chat session
router.post('/session/new', async (req, res) => {
  try {
    const sessionId = uuidv4();
    const newChat = new Chat({
      sessionId,
      title: 'New Chat',
      messages: []
    });
    
    await newChat.save();
    
    res.json({
      success: true,
      sessionId,
      chat: newChat
    });
  } catch (error) {
    console.error('Error creating new chat session:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create new chat session'
    });
  }
});

// Save message to chat session
router.post('/session/:sessionId/message', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { type, content, isError = false } = req.body;
    
    if (!type || !content) {
      return res.status(400).json({
        success: false,
        error: 'Type and content are required'
      });
    }
    
    let chat = await Chat.findOne({ sessionId });
    
    if (!chat) {
      // Create new chat if it doesn't exist
      chat = new Chat({
        sessionId,
        title: 'New Chat',
        messages: []
      });
    }
    
    // Add message to chat
    chat.messages.push({
      type,
      content,
      isError,
      timestamp: new Date()
    });
    
    await chat.save();
    
    res.json({
      success: true,
      message: 'Message saved successfully',
      chat
    });
  } catch (error) {
    console.error('Error saving message:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save message'
    });
  }
});

// Delete chat session
router.delete('/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const deletedChat = await Chat.findOneAndDelete({ sessionId });
    
    if (!deletedChat) {
      return res.status(404).json({
        success: false,
        error: 'Chat session not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Chat session deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting chat session:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete chat session'
    });
  }
});

// Update chat title
router.put('/session/:sessionId/title', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { title } = req.body;
    
    if (!title) {
      return res.status(400).json({
        success: false,
        error: 'Title is required'
      });
    }
    
    const chat = await Chat.findOneAndUpdate(
      { sessionId },
      { title, updatedAt: new Date() },
      { new: true }
    );
    
    if (!chat) {
      return res.status(404).json({
        success: false,
        error: 'Chat session not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Chat title updated successfully',
      chat
    });
  } catch (error) {
    console.error('Error updating chat title:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update chat title'
    });
  }
});

module.exports = router;
