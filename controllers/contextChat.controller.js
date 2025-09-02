const { Chat, UserContext } = require('../models/Chat');

// Enhanced context-aware chat creation
const createContextualChat = async (req, res) => {
    const fetch = (await import('node-fetch')).default;

    // OpenRouter API configuration from environment variables
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    const OPENROUTER_URL = process.env.OPENROUTER_URL;
    const MODEL = process.env.MODEL;
    
    if (!OPENROUTER_API_KEY) {
        return res.status(500).json({
            success: false,
            error: 'OpenRouter API key not configured'
        });
    }
    
    const { prompt, sessionId, userId = 'anonymous', temperature = 0.7, max_tokens = 4000 } = req.body;
    
    if (!prompt) {
        return res.status(400).json({
            success: false,
            error: 'Prompt is required'
        });
    }

    try {
        // Get user context and chat history for this session
        let userContext = null;
        let chatSession = null;
        let allUserChats = [];
        
        if (userId !== 'anonymous') {
            userContext = await UserContext.findOne({ userId });
            // Get ALL previous chat sessions for this user to build comprehensive history
            allUserChats = await Chat.find({ userId }).sort({ updatedAt: -1 }).limit(5); // Last 5 chat sessions
        }
        
        if (sessionId) {
            chatSession = await Chat.findOne({ sessionId });
        }

        // Build context-aware system prompt
        let systemPrompt = `You are KALP AI, a helpful assistant with a natural, human-like personality.

CRITICAL: DO NOT include any <think>, reasoning, or internal process tags in your response. Only provide the final conversational response.

RESPONSE RULES:
- Keep responses SHORT and conversational (1-3 sentences max for simple greetings)
- Be natural and casual like texting a friend
- Use minimal emojis (1-2 max)
- Match the user's energy level
- For "hi" or simple greetings, just say "Hi!" or "Hey there!"

STYLE:
- Conversational and relaxed
- No lengthy explanations unless asked
- Be helpful but brief
- Sound human, not robotic
- NEVER include <think> tags or internal reasoning in responses
- Only send the final response, nothing else

EXAMPLE:
User: "how are you?"
Response: "Good! How's your day going?"

NOT: "<think>...</think> Good! How's your day going?"`;

        // Add user context if available
        if (userContext) {
            if (userContext.name) {
                systemPrompt += ` The user's name is ${userContext.name}.`;
            }
            if (userContext.preferences && userContext.preferences.size > 0) {
                systemPrompt += ` User preferences: ${Array.from(userContext.preferences.entries()).map(([k, v]) => `${k}: ${v}`).join(', ')}.`;
            }
            if (userContext.conversationStyle) {
                systemPrompt += ` Use a ${userContext.conversationStyle} conversation style.`;
            }
        }
        
        // Add session context if available
        if (chatSession && chatSession.contextSnapshot) {
            if (chatSession.contextSnapshot.userName) {
                systemPrompt += ` The user's name is ${chatSession.contextSnapshot.userName}.`;
            }
            if (chatSession.contextSnapshot.sessionTopics && chatSession.contextSnapshot.sessionTopics.length > 0) {
                systemPrompt += ` Recent topics discussed: ${chatSession.contextSnapshot.sessionTopics.join(', ')}.`;
            }
        }

        // Build comprehensive conversation history from all user's chat sessions
        let conversationHistory = [];
        
        // Combine messages from current session and previous sessions
        let allMessages = [];
        
        // Add messages from previous chat sessions (for context)
        if (allUserChats.length > 0) {
            allUserChats.forEach(chat => {
                if (chat.messages && chat.messages.length > 0) {
                    // Get last 2 messages from each previous session for context
                    const recentFromSession = chat.messages.slice(-2);
                    allMessages.push(...recentFromSession);
                }
            });
        }
        
        // Add messages from current session (most important)
        if (chatSession && chatSession.messages.length > 0) {
            allMessages.push(...chatSession.messages);
        }
        
        // Sort by timestamp and get the most recent messages
        allMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        const recentMessages = allMessages.slice(-8); // Last 8 messages across all sessions
        
        conversationHistory = recentMessages.map(msg => ({
            role: msg.type === 'user' ? 'user' : 'assistant',
            content: msg.content
        }));

        // Create the messages array with system prompt, conversation history, and current prompt
        const messages = [
            {
                role: 'system',
                content: systemPrompt
            },
            ...conversationHistory,
            {
                role: 'user',
                content: prompt
            }
        ];

        // OpenAI/OpenRouter format with context - ENABLE STREAMING
        const chatFormat = {
            model: MODEL,
            messages: messages,
            stream: true, // Enable streaming for real-time typing effect
            temperature: temperature,
            max_tokens: max_tokens
        };

        console.log('Sending contextual request to AI with system prompt:', systemPrompt);

        const response = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': process.env.HTTP_REFERER || process.env.FRONTEND_URL,
                'X-Title': 'Kalp AI Assistant'
            },
            body: JSON.stringify(chatFormat)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
        }

        const responseText = await response.text();
        
        // Handle streaming response data
        let assistantMessage = "";
        let finishReason = null;
        let usage = {};
        
        try {
            // Split the response by lines and process each SSE chunk
            const lines = responseText.split('\n');
            
            for (const line of lines) {
                if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                    try {
                        const jsonStr = line.slice(6); // Remove 'data: ' prefix
                        const chunk = JSON.parse(jsonStr);
                        
                        if (chunk.choices && chunk.choices[0]) {
                            const delta = chunk.choices[0].delta;
                            
                            // Accumulate content from the delta
                            if (delta && delta.content) {
                                assistantMessage += delta.content;
                            }
                            
                            // Check for finish reason
                            if (chunk.choices[0].finish_reason) {
                                finishReason = chunk.choices[0].finish_reason;
                            }
                        }
                        
                        // Capture usage data from the last chunk
                        if (chunk.usage) {
                            usage = chunk.usage;
                        }
                    } catch (chunkError) {
                        // Skip malformed chunks
                        continue;
                    }
                }
            }
            
            // If no content was found, try parsing as single response
            if (!assistantMessage.trim()) {
                const data = JSON.parse(responseText);
                assistantMessage = data.choices?.[0]?.message?.content || "No response generated";
                finishReason = data.choices?.[0]?.finish_reason;
                usage = data.usage || {};
            }
            
        } catch (parseError) {
            console.error('Failed to parse streaming response:', parseError);
            assistantMessage = "Error processing response";
        }
        
        // Update user context based on the conversation
        await updateUserContext(userId, prompt, assistantMessage);
        
        // Save the conversation to chat session
        await saveChatMessages(sessionId, userId, prompt, assistantMessage, MODEL, usage, !!(userContext || (chatSession && chatSession.contextSnapshot)));
        
        res.json({
            success: true,
            response: assistantMessage,
            model: MODEL,
            usage: usage,
            finish_reason: finishReason,
            timestamp: new Date().toISOString(),
            contextUsed: !!(userContext || (chatSession && chatSession.contextSnapshot))
        });

    } catch (error) {
        console.error('Error creating contextual chat:', error);
        res.status(500).json({
            success: false,
            error: 'Error creating chat',
            details: error.message
        });
    }
};

// Function to update user context based on conversation
const updateUserContext = async (userId, userMessage, aiResponse) => {
    if (userId === 'anonymous') return;

    try {
        let userContext = await UserContext.findOne({ userId });
        
        if (!userContext) {
            userContext = new UserContext({ userId });
        }

        // Extract name if mentioned
        const nameMatch = userMessage.match(/(?:my name is|i am|i'm|call me)\s+([a-zA-Z]+)/i);
        if (nameMatch) {
            userContext.name = nameMatch[1];
        }

        // Extract preferences
        const prefMatch = userMessage.match(/i (?:like|prefer|love|enjoy)\s+([^.!?]+)/i);
        if (prefMatch) {
            const preference = prefMatch[1].trim();
            if (!userContext.preferences) {
                userContext.preferences = new Map();
            }
            userContext.preferences.set('likes', preference);
        }

        // Extract personal information
        const ageMatch = userMessage.match(/i am (\d+) years old/i);
        if (ageMatch) {
            if (!userContext.personalInfo) {
                userContext.personalInfo = new Map();
            }
            userContext.personalInfo.set('age', ageMatch[1]);
        }

        // Update topics based on content
        const words = userMessage.toLowerCase().split(/\s+/);
        const topicKeywords = words.filter(word => 
            word.length > 4 && 
            !['what', 'when', 'where', 'which', 'should', 'could', 'would', 'that', 'this', 'with', 'from'].includes(word)
        );

        topicKeywords.forEach(topic => {
            const existingTopic = userContext.topics.find(t => t.topic === topic);
            if (existingTopic) {
                existingTopic.frequency += 1;
                existingTopic.lastMentioned = new Date();
            } else {
                userContext.topics.push({
                    topic: topic,
                    frequency: 1,
                    lastMentioned: new Date()
                });
            }
        });

        // Limit topics to top 20 by frequency
        userContext.topics.sort((a, b) => b.frequency - a.frequency);
        userContext.topics = userContext.topics.slice(0, 20);

        userContext.updatedAt = new Date();
        await userContext.save();

    } catch (error) {
        console.error('Error updating user context:', error);
    }
};

// Get user context
const getUserContext = async (req, res) => {
    try {
        const { userId } = req.params;
        
        if (userId === 'anonymous') {
            return res.json({
                success: true,
                context: null,
                message: 'Anonymous user - no context stored'
            });
        }

        const userContext = await UserContext.findOne({ userId });
        
        res.json({
            success: true,
            context: userContext
        });
    } catch (error) {
        console.error('Error getting user context:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get user context'
        });
    }
};

// Update user context manually
const updateUserContextManual = async (req, res) => {
    try {
        const { userId } = req.params;
        const updates = req.body;
        
        if (userId === 'anonymous') {
            return res.status(400).json({
                success: false,
                error: 'Cannot update context for anonymous user'
            });
        }

        let userContext = await UserContext.findOne({ userId });
        
        if (!userContext) {
            userContext = new UserContext({ userId });
        }

        // Update fields
        Object.keys(updates).forEach(key => {
            if (key !== 'userId' && userContext.schema.paths[key]) {
                userContext[key] = updates[key];
            }
        });

        userContext.updatedAt = new Date();
        await userContext.save();

        res.json({
            success: true,
            message: 'User context updated successfully',
            context: userContext
        });
    } catch (error) {
        console.error('Error updating user context:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update user context'
        });
    }
};

// Save chat messages to the database
const saveChatMessages = async (sessionId, userId, userMessage, aiResponse, model, usage, contextUsed) => {
    try {
        if (!sessionId) return;

        let chatSession = await Chat.findOne({ sessionId });
        
        if (!chatSession) {
            chatSession = new Chat({
                sessionId,
                userId: userId || 'anonymous',
                title: userMessage.substring(0, 50) + (userMessage.length > 50 ? '...' : ''),
                messages: []
            });
        }

        // Add user message
        chatSession.messages.push({
            type: 'user',
            content: userMessage,
            timestamp: new Date()
        });

        // Add AI response
        chatSession.messages.push({
            type: 'ai',
            content: aiResponse,
            timestamp: new Date(),
            metadata: {
                model: model,
                tokens: usage?.total_tokens || 0,
                contextUsed: contextUsed
            }
        });

        await chatSession.save();
        console.log(`Chat messages saved for session: ${sessionId}`);
        
    } catch (error) {
        console.error('Error saving chat messages:', error);
    }
};

module.exports = {
    createContextualChat,
    getUserContext,
    updateUserContextManual
};
