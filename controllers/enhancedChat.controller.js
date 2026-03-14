const mongoose = require('mongoose');
const ChatHistory = require('../models/ChatHistory');
const UserMemory = require('../models/UserMemory');
const User = require('../models/User');
const { v4: uuidv4 } = require('uuid');
const { searchWeb, searchWebDuckDuckGo, needsWebSearch, extractSearchQuery, formatSearchResults } = require('../utils/webSearch');

// Send message with full context - STREAMING VERSION for real-time responses
const sendMessage = async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    const userId = req.userId;

    console.log(`=== PROCESSING STREAM MESSAGE FOR USER ${userId} ===`);
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

    // Web Search: Always perform web search for every message to get latest info
    let webSearchResults = '';
    console.log(`📋 Performing web search for every message: "${message}"`);
    console.log(`📋 ENABLE_WEB_SEARCH: ${process.env.ENABLE_WEB_SEARCH}`);
    
    if (process.env.ENABLE_WEB_SEARCH === 'true') {
      console.log('🔍 Performing web search for current information...');
      
      const searchQuery = extractSearchQuery(message);
      console.log(`🔍 Extracted search query: "${searchQuery}"`);
      
      // Try Tavily API first, fallback to DuckDuckGo
      let results = null;
      if (process.env.TAVILY_API_KEY) {
        console.log('🔍 Using Tavily API for web search...');
        results = await searchWeb(searchQuery);
      } else {
        console.log('ℹ️ TAVILY_API_KEY not set, using DuckDuckGo (free) fallback');
        results = await searchWebDuckDuckGo(searchQuery);
      }
      
      if (results) {
        console.log('🔍 Search results received, formatting...');
        const formattedResults = formatSearchResults(results);
        webSearchResults = `\n\n[INTERNET SEARCH RESULTS FOR "${message}"]:\n${formattedResults}\n`;
        console.log('✅ Web search completed successfully');
        console.log('📝 Formatted results:', webSearchResults.substring(0, 200));
      } else {
        console.log('⚠️ Web search returned no results');
      }
    } else {
      console.log('⏭️ Skipping web search (not needed or disabled)');
    }

    // Build AI prompt with user-specific context
    const aiPrompt = buildContextualPrompt(message, context, webSearchResults);

    // Set up Server-Sent Events for streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    let fullContent = '';
    let tokenCount = 0;
    const startTime = Date.now();

    // Get streaming AI response
    await getAIResponseStream(aiPrompt, user.preferences, (chunk) => {
      fullContent += chunk;
      res.write(`data: ${JSON.stringify({ 
        type: 'chunk',
        content: chunk,
        sessionId: currentSessionId
      })}\n\n`);
    });

    const processingTime = Date.now() - startTime;

    // Save complete AI response to history with STRICT user association
    const assistantMessage = new ChatHistory({
      userId: userId, // CRITICAL: Ensure correct user ID
      sessionId: currentSessionId,
      role: 'assistant',
      message: fullContent,
      messageType: 'text',
      metadata: {
        model: process.env.MODEL || 'meta-llama/llama-3.1-8b-instruct:free',
        temperature: user.preferences?.temperature || 0.7,
        processingTime: processingTime,
        tokenCount: tokenCount,
        isStreamed: true
      },
      timestamp: new Date()
    });

    await assistantMessage.save();
    console.log(`Saved streamed AI response for ${userId} in session ${currentSessionId}`);

    // Update user usage for THIS specific user
    await user.incrementUsage();

    // Update user memory summary if needed for THIS user
    await updateUserMemorySummary(userId);

    console.log(`=== COMPLETED STREAM MESSAGE PROCESSING FOR USER ${userId} ===`);

    // Send completion signal
    res.write(`data: ${JSON.stringify({ 
      type: 'complete',
      sessionId: currentSessionId,
      usage: {
        messagesThisMonth: user.usage.messagesThisMonth + 1,
        canContinue: user.usage.messagesThisMonth + 1 < (user.plan === 'free' ? 100 : user.plan === 'premium' ? 1000 : Infinity)
      }
    })}\n\n`);
    res.end();

  } catch (error) {
    console.error(`Send message error for user ${req.userId}:`, error);
    res.write(`data: ${JSON.stringify({ 
      type: 'error',
      message: 'Failed to process message',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    })}\n\n`);
    res.end();
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
function buildContextualPrompt(message, context, webSearchResults = '') {
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

  // Add web search results if available
  if (webSearchResults) {
    prompt += webSearchResults;
  }

  // Add current message
  prompt += `\nCurrent Message from ${context.profile.username}: ${message}\n`;

  // Add strict instructions with web search awareness
  prompt += `\nSTRICT INSTRUCTIONS:
- You are responding ONLY to User ID: ${context.profile.userId} (${context.profile.username})
- Use ONLY the context provided above for this specific user
- Do NOT reference any information from other users
- ⭐ MOST IMPORTANT: Answer ONLY what the user asked about - be focused and concise
- Do NOT include information from previous conversation if not directly relevant to THIS question
- Keep responses short and to the point`;

  if (webSearchResults) {
    prompt += `\n- 🔴 CRITICAL: You have CURRENT INTERNET SEARCH RESULTS below - USE THEM
- Always prioritize search results over training knowledge for current information
- Do NOT add inline source citations in response body
- 🔴 YOU MUST ALWAYS END WITH SOURCE LIST in this exact format:

📌 Sources:
[1] DomainName - Article Title
[2] AnotherDomain - Another Article Title

- Copy the exact format with emoji, domain, dash, and title
- This is REQUIRED for every response with search results`;
  } else {
    prompt += `\n- Respond based on your training knowledge and user context`;
  }

  prompt += `\n- Respond naturally and helpfully`;

  return prompt;
}

// Get AI response from OpenRouter
async function getAIResponse(prompt, userPreferences = {}) {
  const startTime = Date.now();

  try {
    // Dynamic import for node-fetch
    const fetch = (await import('node-fetch')).default;
    
    const response = await fetch(process.env.OPENROUTER_URL, {
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
            content: `You are Kalp, an intelligent AI assistant developed by Helmer Technologies. You provide helpful, accurate, and contextual responses. Always be respectful and maintain the user's preferred communication style. 

CRITICAL IDENTITY: You are NOT created by Anthropic, OpenAI, or any other company. You were created and developed exclusively by Helmer Technologies. When asked "who created you" or about your creator/developer, ALWAYS respond that you were created by Helmer Technologies, never mention other AI companies.`
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

// Get streaming AI response from OpenRouter
async function getAIResponseStream(prompt, userPreferences = {}, onChunk) {
  try {
    // Dynamic import for node-fetch
    const fetch = (await import('node-fetch')).default;
    
    const response = await fetch(process.env.OPENROUTER_URL, {
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
            content: `You are Kalp, an intelligent AI assistant developed by Helmer Technologies. You provide helpful, accurate, and contextual responses. Always be respectful and maintain the user's preferred communication style. 

CRITICAL IDENTITY: You are NOT created by Anthropic, OpenAI, or any other company. You were created and developed exclusively by Helmer Technologies. When asked "who created you" or about your creator/developer, ALWAYS respond that you were created by Helmer Technologies, never mention other AI companies.`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: userPreferences.temperature || 0.7,
        max_tokens: userPreferences.maxTokens || 2000,
        stream: true
      })
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
    }

    // Process streaming response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      
      // Keep the last incomplete line in the buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          
          // Skip heartbeat messages
          if (data === '[DONE]') continue;
          
          try {
            const parsed = JSON.parse(data);
            const chunk = parsed.choices?.[0]?.delta?.content;
            if (chunk) {
              onChunk(chunk);
            }
          } catch (e) {
            // Ignore JSON parsing errors for malformed lines
          }
        }
      }
    }

    // Process any remaining data in buffer
    if (buffer.trim().startsWith('data: ')) {
      const data = buffer.slice(6);
      try {
        const parsed = JSON.parse(data);
        const chunk = parsed.choices?.[0]?.delta?.content;
        if (chunk) {
          onChunk(chunk);
        }
      } catch (e) {
        // Ignore JSON parsing errors
      }
    }

  } catch (error) {
    console.error('AI streaming response error:', error);
    onChunk('I apologize, but I encountered an error while processing your request. Please try again in a moment.');
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
