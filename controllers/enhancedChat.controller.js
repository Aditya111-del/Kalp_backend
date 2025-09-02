const mongoose = require('mongoose');
const ChatHistory = require('../models/ChatHistory');
const UserMemory = require('../models/UserMemory');
const User = require('../models/User');
const { v4: uuidv4 } = require('uuid');

// Send message with full context - COMPLETE USER ISOLATION
const sendMessage = async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    const userId = req.userId;

    console.log(`=== PROCESSING MESSAGE FOR USER ${userId} ===`);
    console.log(`User ID: ${userId}, Session: ${sessionId}, Message: ${message?.substring(0, 50)}...`);

    // Validate input
    if (!message || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Message content is required'
      });
    }

    // CRITICAL: Validate user exists and get user data
    const user = await User.findById(userId);
    if (!user) {
      console.error(`User not found: ${userId}`);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    console.log(`Authenticated user: ${user.username} (${user.displayName})`);

    // Check usage limits for THIS specific user
    if (!user.canSendMessage()) {
      console.log(`User ${userId} reached message limit`);
      return res.status(429).json({
        success: false,
        message: 'Monthly message limit reached. Please upgrade your plan.',
        usage: {
          current: user.usage.messagesThisMonth,
          limit: user.plan === 'free' ? 100 : user.plan === 'premium' ? 1000 : 'unlimited'
        }
      });
    }

    // Generate session ID if not provided
    const currentSessionId = sessionId || uuidv4();
    console.log(`Using session ID: ${currentSessionId}`);

    // CRITICAL: Get context ONLY for this specific user
    const context = await buildUserContext(userId, currentSessionId);
    console.log(`Built context for user ${userId}:`, {
      hasMemory: context.memory.summary.length > 0,
      recentMessages: context.recentMessages.length,
      keyTopics: context.memory.keyTopics.length
    });

    // Save user message to history with STRICT user association
    const userMessage = new ChatHistory({
      userId: userId, // CRITICAL: Ensure correct user ID
      sessionId: currentSessionId,
      role: 'user',
      message: message.trim(),
      messageType: 'text',
      timestamp: new Date()
    });

    await userMessage.save();
    console.log(`Saved user message for ${userId} in session ${currentSessionId}`);

    // Update user memory with new topics for THIS user only
    await updateUserMemoryFromMessage(userId, message);

    // Build AI prompt with user-specific context
    const aiPrompt = buildContextualPrompt(message, context);

    // Get AI response
    const aiResponse = await getAIResponse(aiPrompt, user.preferences);

    // Save AI response to history with STRICT user association
    const assistantMessage = new ChatHistory({
      userId: userId, // CRITICAL: Ensure correct user ID
      sessionId: currentSessionId,
      role: 'assistant',
      message: aiResponse.content,
      messageType: 'text',
      metadata: {
        model: aiResponse.model || process.env.MODEL,
        temperature: aiResponse.temperature,
        processingTime: aiResponse.processingTime,
        tokenCount: aiResponse.tokenCount
      },
      timestamp: new Date()
    });

    await assistantMessage.save();
    console.log(`Saved AI response for ${userId} in session ${currentSessionId}`);

    // Update user usage for THIS specific user
    await user.incrementUsage();

    // Update user memory summary if needed for THIS user
    await updateUserMemorySummary(userId);

    console.log(`=== COMPLETED MESSAGE PROCESSING FOR USER ${userId} ===`);

    res.json({
      success: true,
      sessionId: currentSessionId,
      message: aiResponse.content,
      context: {
        hasContext: context.memory.summary.length > 0,
        recentMessages: context.recentMessages.length,
        keyTopics: context.memory.keyTopics.slice(0, 3)
      },
      usage: {
        messagesThisMonth: user.usage.messagesThisMonth + 1,
        canContinue: user.usage.messagesThisMonth + 1 < (user.plan === 'free' ? 100 : user.plan === 'premium' ? 1000 : Infinity)
      }
    });

  } catch (error) {
    console.error(`Send message error for user ${req.userId}:`, error);
    res.status(500).json({
      success: false,
      message: 'Failed to process message',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get chat history for user - STRICT USER ISOLATION
const getChatHistory = async (req, res) => {
  try {
    const { sessionId, limit = 50 } = req.query;
    const userId = req.userId;

    console.log(`Getting chat history for user ${userId}, session: ${sessionId}`);

    let messages;
    
    if (sessionId) {
      // Get specific session history ONLY for this user
      messages = await ChatHistory.find({ 
        userId: new mongoose.Types.ObjectId(userId), // Convert to ObjectId
        sessionId: sessionId 
      })
      .sort({ timestamp: 1 })
      .limit(parseInt(limit))
      .select('role message timestamp messageType metadata');
      
      console.log(`Found ${messages.length} messages for user ${userId} in session ${sessionId}`);
    } else {
      // Get recent messages across all sessions ONLY for this user
      messages = await ChatHistory.find({ 
        userId: new mongoose.Types.ObjectId(userId) // Convert to ObjectId
      })
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .select('role message timestamp sessionId messageType metadata');
      
      console.log(`Found ${messages.length} recent messages for user ${userId}`);
    }

    res.json({
      success: true,
      messages,
      count: messages.length,
      userId: userId // Include for verification
    });

  } catch (error) {
    console.error(`Get chat history error for user ${req.userId}:`, error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve chat history'
    });
  }
};

// Get user's chat sessions - STRICT USER ISOLATION
const getUserSessions = async (req, res) => {
  try {
    const userId = req.userId;
    
    console.log(`Getting sessions for user ${userId}`);
    
    // Get sessions ONLY for this specific user
    const sessions = await ChatHistory.aggregate([
      { 
        $match: { 
          userId: new mongoose.Types.ObjectId(userId) // Convert string to ObjectId
        } 
      },
      {
        $group: {
          _id: '$sessionId',
          lastMessage: { $last: '$message' },
          lastTimestamp: { $last: '$timestamp' },
          messageCount: { $sum: 1 },
          firstMessage: { $first: '$message' },
          userId: { $first: '$userId' } // Track user ID for verification
        }
      },
      { $sort: { lastTimestamp: -1 } },
      { $limit: 50 }
    ]);
    
    // Double-check that all sessions belong to this user
    const validSessions = sessions.filter(session => 
      session.userId && session.userId.toString() === userId
    );
    
    console.log(`Found ${validSessions.length} sessions for user ${userId}`);
    
    res.json({
      success: true,
      sessions: validSessions.map(session => ({
        sessionId: session._id,
        title: session.firstMessage.substring(0, 50) + '...',
        lastMessage: session.lastMessage,
        lastTimestamp: session.lastTimestamp,
        messageCount: session.messageCount,
        userId: session.userId // Include for verification
      })),
      userId: userId // Include for verification
    });
    
  } catch (error) {
    console.error(`Get user sessions error for user ${req.userId}:`, error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve sessions'
    });
  }
};

// Delete a chat session - STRICT USER VALIDATION
const deleteSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.userId;

    // CRITICAL: Validate sessionId is provided
    if (!sessionId || sessionId === 'undefined' || sessionId === 'null') {
      console.log(`Invalid sessionId provided by user ${userId}: ${sessionId}`);
      return res.status(400).json({
        success: false,
        message: 'Valid session ID is required'
      });
    }

    console.log(`User ${userId} attempting to delete session ${sessionId}`);

    // CRITICAL: Verify session belongs to this user before deletion
    const sessionCheck = await ChatHistory.findOne({ 
      userId: new mongoose.Types.ObjectId(userId), 
      sessionId: sessionId 
    });

    if (!sessionCheck) {
      console.log(`Session ${sessionId} not found for user ${userId}`);
      return res.status(404).json({
        success: false,
        message: 'Session not found or access denied'
      });
    }

    // Delete ONLY messages from this user in this session
    const result = await ChatHistory.deleteMany({ 
      userId: new mongoose.Types.ObjectId(userId), // Convert to ObjectId
      sessionId: sessionId 
    });

    console.log(`Deleted ${result.deletedCount} messages from session ${sessionId} for user ${userId}`);

    res.json({
      success: true,
      message: `Deleted ${result.deletedCount} messages from session`,
      deletedCount: result.deletedCount,
      sessionId: sessionId,
      userId: userId
    });

  } catch (error) {
    console.error(`Delete session error for user ${req.userId}:`, error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete session'
    });
  }
};

// Build user context for AI - COMPLETELY ISOLATED PER USER
async function buildUserContext(userId, sessionId) {
  try {
    // CRITICAL: Ensure we only get data for THIS specific user
    const user = await User.findById(userId);
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    // Get ONLY this user's memory - strict user isolation
    const userMemory = await UserMemory.findOne({ userId: userId });

    // Get ONLY this user's messages from THIS session
    const sessionMessages = await ChatHistory.find({ 
      userId: userId, 
      sessionId: sessionId 
    })
    .sort({ timestamp: 1 })
    .limit(10)
    .select('role message timestamp');

    // Get ONLY this user's recent messages across all THEIR sessions
    const recentMessages = await ChatHistory.find({ 
      userId: userId // ONLY this user's messages
    })
    .sort({ timestamp: -1 })
    .limit(20)
    .select('role message timestamp sessionId');

    console.log(`Building context for user ${userId} (${user.username}) - Session: ${sessionId}`);
    console.log(`Found ${sessionMessages.length} session messages, ${recentMessages.length} recent messages`);

    return {
      profile: {
        userId: userId, // Explicitly track user ID
        username: user.username,
        displayName: user.displayName,
        preferences: user.preferences || {}
      },
      memory: userMemory ? {
        summary: userMemory.summary || '',
        keyTopics: userMemory.keyTopics || [],
        preferences: userMemory.userPreferences || {}
      } : {
        summary: '',
        keyTopics: [],
        preferences: {}
      },
      recentMessages: sessionMessages,
      crossSessionContext: recentMessages.slice(0, 5)
    };

  } catch (error) {
    console.error(`Build user context error for user ${userId}:`, error);
    return {
      profile: { 
        userId: userId,
        username: 'User', 
        preferences: {} 
      },
      memory: { 
        summary: '', 
        keyTopics: [], 
        preferences: {} 
      },
      recentMessages: [],
      crossSessionContext: []
    };
  }
}

// Build contextual prompt for AI - ENSURE USER ISOLATION
function buildContextualPrompt(message, context) {
  // CRITICAL: Validate that we have the correct user context
  if (!context.profile.userId) {
    console.error('WARNING: No user ID in context - potential data leak!');
    return `Message: ${message}\nInstructions: Respond helpfully but without any personal context.`;
  }

  let prompt = `User Profile:
- User ID: ${context.profile.userId}
- Username: ${context.profile.username || 'Unknown'}
- Display Name: ${context.profile.displayName || context.profile.username || 'User'}
`;

  // Add AI tone preference if available
  if (context.profile.preferences?.aiTone) {
    prompt += `- Preferred Communication Style: ${context.profile.preferences.aiTone}\n`;
  }

  // Add user-specific memory summary
  if (context.memory.summary && context.memory.summary.length > 10) {
    prompt += `\nUser-Specific Context (ID: ${context.profile.userId}):
${context.memory.summary}\n`;
  }

  // Add user-specific key topics
  if (context.memory.keyTopics && context.memory.keyTopics.length > 0) {
    const topics = context.memory.keyTopics.slice(0, 5).map(t => t.topic || t).join(', ');
    prompt += `\nUser's Key Interests: ${topics}\n`;
  }

  // Add recent conversation context FROM THIS USER ONLY
  if (context.recentMessages && context.recentMessages.length > 0) {
    prompt += `\nRecent Conversation History (User ID: ${context.profile.userId}):\n`;
    context.recentMessages.slice(-5).forEach((msg, index) => {
      prompt += `${index + 1}. ${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.message}\n`;
    });
  }

  // Add current message
  prompt += `\nCurrent Message from ${context.profile.username}: ${message}\n`;

  // Add strict instructions
  prompt += `\nSTRICT INSTRUCTIONS:
- You are responding ONLY to User ID: ${context.profile.userId} (${context.profile.username})
- Use ONLY the context provided above for this specific user
- Do NOT reference any information from other users
- Respond naturally and helpfully, incorporating this user's specific context and preferences
- Be personalized but maintain appropriate boundaries`;

  return prompt;
}

// Get AI response from OpenRouter
async function getAIResponse(prompt, userPreferences = {}) {
  const startTime = Date.now();

  try {
    // Dynamic import for node-fetch
    const fetch = (await import('node-fetch')).default;
    
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'X-Title': 'Kalp AI Assistant'
      },
      body: JSON.stringify({
        model: process.env.MODEL || 'meta-llama/llama-3.1-8b-instruct:free',
        messages: [
          {
            role: 'system',
            content: `You are Kalp, an intelligent AI assistant. You provide helpful, accurate, and contextual responses. Always be respectful and maintain the user's preferred communication style.`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: userPreferences.temperature || 0.7,
        max_tokens: userPreferences.maxTokens || 2000,
        stream: false
      })
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const processingTime = Date.now() - startTime;

    return {
      content: data.choices[0]?.message?.content || 'I apologize, but I was unable to generate a response. Please try again.',
      model: data.model,
      temperature: userPreferences.temperature || 0.7,
      processingTime,
      tokenCount: data.usage?.total_tokens || 0
    };

  } catch (error) {
    console.error('AI response error:', error);
    return {
      content: 'I apologize, but I encountered an error while processing your request. Please try again in a moment.',
      model: 'error',
      temperature: 0.7,
      processingTime: Date.now() - startTime,
      tokenCount: 0
    };
  }
}

// Update user memory from message - STRICT USER ISOLATION
async function updateUserMemoryFromMessage(userId, message) {
  try {
    console.log(`Updating memory for user ID: ${userId}`);
    
    // CRITICAL: Find or create memory ONLY for this specific user
    let userMemory = await UserMemory.findOne({ userId: userId });
    
    if (!userMemory) {
      userMemory = new UserMemory({
        userId: userId,
        summary: '',
        keyTopics: [],
        userPreferences: {},
        conversationMetrics: {
          totalMessages: 0,
          sessionsCount: 0,
          avgSessionLength: 0,
          lastActiveDate: new Date()
        },
        contextData: {},
        createdAt: new Date(),
        updatedAt: new Date()
      });
      console.log(`Created new memory for user ${userId}`);
    }

    // Extract key topics (simple keyword extraction)
    const keywords = extractKeywords(message);
    keywords.forEach(keyword => {
      // Check if topic already exists
      const existingTopic = userMemory.keyTopics.find(t => 
        (t.topic || t) === keyword
      );
      
      if (existingTopic) {
        // Increment frequency if it's an object
        if (typeof existingTopic === 'object' && existingTopic.frequency) {
          existingTopic.frequency += 1;
        }
      } else {
        // Add new topic
        userMemory.keyTopics.push({
          topic: keyword,
          frequency: 1,
          firstMentioned: new Date()
        });
      }
    });

    // Limit topics to prevent memory bloat
    if (userMemory.keyTopics.length > 50) {
      userMemory.keyTopics = userMemory.keyTopics
        .sort((a, b) => (b.frequency || 1) - (a.frequency || 1))
        .slice(0, 50);
    }

    // Update conversation metrics
    userMemory.conversationMetrics.totalMessages += 1;
    userMemory.conversationMetrics.lastActiveDate = new Date();
    userMemory.updatedAt = new Date();

    await userMemory.save();
    console.log(`Memory updated for user ${userId}: ${userMemory.keyTopics.length} topics`);

  } catch (error) {
    console.error(`Update user memory error for user ${userId}:`, error);
  }
}

// Simple keyword extraction
function extractKeywords(text) {
  // Remove common words and extract meaningful terms
  const commonWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'can', 'may', 'might', 'must', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'this', 'that', 'these', 'those']);
  
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 3 && !commonWords.has(word));

  // Return unique words, limited to prevent memory bloat
  return [...new Set(words)].slice(0, 10);
}

// Update user memory summary periodically - STRICT USER ISOLATION
async function updateUserMemorySummary(userId) {
  try {
    console.log(`Updating memory summary for user ID: ${userId}`);
    
    // CRITICAL: Get memory ONLY for this specific user
    const userMemory = await UserMemory.findOne({ userId: userId });
    if (!userMemory) {
      console.log(`No memory found for user ${userId}`);
      return;
    }

    // Update summary every 20 messages
    if (userMemory.conversationMetrics.totalMessages % 20 === 0) {
      // Get recent messages ONLY for this user
      const recentMessages = await ChatHistory.find({ userId: new mongoose.Types.ObjectId(userId) })
        .sort({ timestamp: -1 })
        .limit(50)
        .select('role message timestamp');
      
      if (recentMessages.length > 10) {
        // Build user-specific summary
        const topTopics = userMemory.keyTopics
          .sort((a, b) => (b.frequency || 1) - (a.frequency || 1))
          .slice(0, 10)
          .map(t => t.topic || t)
          .join(', ');

        const communicationStyle = userMemory.userPreferences?.communicationStyle || 'conversational';
        const responseLength = userMemory.userPreferences?.responseLength || 'medium';
        
        const newSummary = `User ID ${userId} - Recent topics: ${topTopics}. Communication style: ${communicationStyle}. Prefers ${responseLength} responses. Active user with ${userMemory.conversationMetrics.totalMessages} total messages.`;
        
        userMemory.summary = newSummary;
        userMemory.updatedAt = new Date();
        await userMemory.save();
        
        console.log(`Memory summary updated for user ${userId}`);
      }
    }

  } catch (error) {
    console.error(`Update memory summary error for user ${userId}:`, error);
  }
}

module.exports = {
  sendMessage,
  getChatHistory,
  getUserSessions,
  deleteSession
};
