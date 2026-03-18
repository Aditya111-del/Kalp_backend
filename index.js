require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const connectDB = require('./config/database'); // Import database connection
const chatRoutes = require('./routes/chat.route.js'); // Import chat routes
const chatHistoryRoutes = require('./routes/chatHistory.route.js'); // Import chat history routes
const authRoutes = require('./routes/auth.route.js'); // Import auth routes
const enhancedAuthRoutes = require('./routes/enhancedAuth.route.js'); // Enhanced auth routes
const enhancedChatRoutes = require('./routes/enhancedChat.route.js'); // Enhanced chat routes
const { createContextualChat } = require('./controllers/contextChat.controller');
const { Chat, UserContext } = require('./models/Chat');
const ChatHistory = require('./models/ChatHistory');
const UserMemory = require('./models/UserMemory');
const User = require('./models/User');
const { searchWeb, searchWebDuckDuckGo, formatSearchResults, needsWebSearch, extractSearchQuery } = require('./utils/webSearch');

// AI API function for WebSocket
async function callAIAPI(message, context) {
    const fetch = (await import('node-fetch')).default;
    
    // Always perform web search for every prompt
    let webSearchResults = '';
    if (process.env.ENABLE_WEB_SEARCH === 'true') {
        console.log('🔍 WebSocket: Performing web search for:', message);
        const searchQuery = extractSearchQuery(message);
        
        let results = null;
        if (process.env.TAVILY_API_KEY) {
            results = await searchWeb(searchQuery);
        } else {
            results = await searchWebDuckDuckGo(searchQuery);
        }
        
        if (results) {
            webSearchResults = formatSearchResults(results);
            console.log('✅ WebSocket: Web search completed');
        }
    }
    
    // Build context-aware prompt
    const systemPrompt = buildSystemPrompt(context, webSearchResults);
    const messages = buildMessageHistory(message, context);

    const primaryModel = process.env.MODEL || 'qwen/qwen3-coder:free';
    const fallbackModelRaw = (process.env.FALLBACK_MODEL || '').trim();
    const deprecatedFallbackModels = new Set(['qwen/qwen-2-7b-instruct:free']);
    const fallbackModel = deprecatedFallbackModels.has(fallbackModelRaw) ? '' : fallbackModelRaw;
    const modelsToTry = [primaryModel];

    if (fallbackModelRaw && !fallbackModel) {
        console.warn(`Ignoring deprecated FALLBACK_MODEL value: ${fallbackModelRaw}`);
    }

    if (fallbackModel && fallbackModel !== primaryModel) {
        modelsToTry.push(fallbackModel);
    }

    let lastError = null;
    let primaryError = null;

    for (let i = 0; i < modelsToTry.length; i++) {
        const selectedModel = modelsToTry[i];
        const requestBody = {
            model: selectedModel,
            messages: [
                { role: 'system', content: systemPrompt },
                ...messages
            ],
            temperature: 0.7,
            max_tokens: 2000,
            top_p: 0.9,
            frequency_penalty: 0.1,
            presence_penalty: 0.1
        };

        const response = await fetch(process.env.OPENROUTER_URL || 'https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://kalp.ai',
                'X-Title': 'Kalp AI Chat'
            },
            body: JSON.stringify(requestBody)
        });

        if (response.ok) {
            const data = await response.json();

            if (!data.choices || !data.choices[0]) {
                throw new Error('Invalid AI response format');
            }

            return {
                content: data.choices[0].message.content,
                model: data.model || selectedModel,
                usage: data.usage
            };
        }

        const errorData = await response.text();
        const isRateLimit = response.status === 429;
        const hasNextModel = i < modelsToTry.length - 1;

        if (!primaryError) {
            primaryError = new Error(`AI API Error: ${response.status} - ${errorData}`);
        }

        if (isRateLimit && hasNextModel) {
            console.warn(`Model ${selectedModel} is rate-limited. Retrying with fallback model ${modelsToTry[i + 1]}.`);
            continue;
        }

        if (response.status === 404 && selectedModel !== primaryModel && primaryError) {
            lastError = primaryError;
            break;
        }

        lastError = new Error(`AI API Error: ${response.status} - ${errorData}`);
        break;
    }

    throw lastError || new Error('AI API Error: All configured models failed');
}

function buildSystemPrompt(context, webSearchResults = '') {
    const { profile, memory } = context;
    
    // START WITH A STRONG WEB SEARCH INDICATOR IF RESULTS ARE AVAILABLE
    let systemPrompt = '';
    
    if (webSearchResults) {
        systemPrompt = `🔴 CRITICAL - YOU HAVE REAL-TIME INTERNET SEARCH RESULTS BELOW 🔴
You MUST use the search results provided below to answer the user's question.
The search results contain current, real-time information from the internet.
IGNORE any knowledge cutoff - the search results are more recent and accurate.

${webSearchResults}

🔴 YOUR INSTRUCTIONS FOR THIS RESPONSE:
1. You MUST use the search results provided above
2. Answer ONLY what the user asked about - be focused and concise
3. Do NOT include information from previous conversation if not directly relevant
4. Every claim about current events, news, prices, or trends must come from the search results
5. Do NOT add inline source citations in the response body - keep it clean
6. Use the latest information from the search results as the primary source
7. 🔴 YOU MUST ALWAYS END WITH THIS SOURCE LIST (copy format exactly):
   
   📌 Sources:
   [1] WebsiteName - Title of Article
   [2] AnotherSite - Another Article Title
   
8. Be concise and directly address the user's question
9. Do NOT ramble or include unnecessary context
10. 🔴 CRITICAL: ALWAYS include the source list at the end - this is required for every response with web search

---

You are Kalp, an advanced AI assistant developed by Helmer Technologies. You are helpful, knowledgeable, and engaging.

IMPORTANT - About Your Identity:
- You are Kalp AI, created and developed by Helmer Technologies
- You are NOT created by Anthropic, OpenAI, or any other company
- When asked "who created you" or similar questions, ALWAYS respond that you were created and developed by Helmer Technologies
- You are proud to be a product of Helmer Technologies' innovation
- Never mention other AI companies as your creator

User Profile:
- Name: ${profile.displayName || profile.username}
- Preferences: ${JSON.stringify(profile.preferences)}`;
    } else {
        systemPrompt = `You are Kalp, an advanced AI assistant developed by Helmer Technologies. You are helpful, knowledgeable, and engaging.

IMPORTANT INSTRUCTION:
- Answer ONLY what the user asked about - be focused and concise
- Do NOT include information from previous conversation if not directly relevant to THIS question
- Keep responses short and to the point

IMPORTANT - About Your Identity:
- You are Kalp AI, created and developed by Helmer Technologies
- You are NOT created by Anthropic, OpenAI, or any other company
- When asked "who created you" or similar questions, ALWAYS respond that you were created and developed by Helmer Technologies
- You are proud to be a product of Helmer Technologies' innovation
- Never mention other AI companies as your creator

User Profile:
- Name: ${profile.displayName || profile.username}
- Preferences: ${JSON.stringify(profile.preferences)}`;
    }

    if (memory && !webSearchResults) {
        systemPrompt += `\n\nUser Memory/Context:\n${memory}`;
    }

    systemPrompt += `\n\nInstructions:
- Provide helpful, accurate, and engaging responses
- Remember the user's context and preferences
- Be conversational and personable
- If you don't know something, admit it honestly
- Keep responses concise but comprehensive`;

    if (webSearchResults) {
        systemPrompt += `\n- ALWAYS prioritize and use the internet search results provided above for current topics
- Do NOT mention knowledge cutoffs when you have search results
- Be confident in providing information from the search results`;
    }


    return systemPrompt;
}

function buildMessageHistory(currentMessage, context) {
    const messages = [];
    
    // Add recent message history for context
    if (context.recentMessages && context.recentMessages.length > 0) {
        context.recentMessages.slice(-5).forEach(msg => {
            messages.push({
                role: msg.role,
                content: msg.message
            });
        });
    }
    
    // Add current message
    messages.push({
        role: 'user',
        content: currentMessage
    });
    
    return messages;
}

// Connect to MongoDB
connectDB();

const app = express();
const server = http.createServer(app);

// Parse CORS origins from environment variable
const defaultOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000', 'https://kalp-jade.vercel.app'];
const corsOrigins = process.env.CORS_ORIGINS 
    ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim()).concat(defaultOrigins)
    : defaultOrigins;

// Remove duplicates
const uniqueCorsOrigins = [...new Set(corsOrigins)];

console.log('🌐 CORS_ORIGINS environment variable:', process.env.CORS_ORIGINS);
console.log('🌐 CORS Origins configured:', uniqueCorsOrigins);
console.log('🌐 NODE_ENV:', process.env.NODE_ENV);

const io = socketIo(server, {
    cors: {
        origin: uniqueCorsOrigins,
        methods: ["GET", "POST"],
        credentials: true
    }
});

const port = process.env.PORT || 5000;

app.use(express.json()); // Middleware to parse JSON

// Add CORS middleware for frontend integration
app.use(cors({
    origin: function (origin, callback) {
        if (!origin || uniqueCorsOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.warn('⚠️  CORS rejected origin:', origin);
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization'],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 200
}));

// Explicit preflight handler
app.options('*', cors({
    origin: function (origin, callback) {
        if (!origin || uniqueCorsOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    optionsSuccessStatus: 200
}));

app.get('/', (req, res) => {
    res.json({ 
        message: 'Welcome to Kalp powered by AI via OpenRouter!',
        model: process.env.MODEL,
        status: 'API is running',
        database: 'MongoDB connected',
        websockets: 'Socket.IO active',
        jwtSecret: process.env.JWT_SECRET ? process.env.JWT_SECRET.substring(0, 10) + '...' : 'Not set'
    });
});

// JWT Test endpoint
app.get('/test-jwt', (req, res) => {
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
    
    // Create a test token
    const testUserId = '12345';
    const token = jwt.sign({ userId: testUserId }, JWT_SECRET, { expiresIn: '1h' });
    
    try {
        // Verify the same token
        const decoded = jwt.verify(token, JWT_SECRET);
        res.json({
            success: true,
            message: 'JWT test successful',
            token,
            decoded,
            secret: JWT_SECRET.substring(0, 10) + '...'
        });
    } catch (error) {
        res.json({
            success: false,
            message: 'JWT test failed',
            error: error.message,
            secret: JWT_SECRET.substring(0, 10) + '...'
        });
    }
});

app.use('/chat', chatRoutes); // Use chat routes
app.use('/api/chat', chatHistoryRoutes); // Use chat history routes
app.use('/api/auth', authRoutes); // Use auth routes
app.use('/api/v2/auth', enhancedAuthRoutes); // Enhanced auth routes
app.use('/api/v2/chat', enhancedChatRoutes); // Enhanced chat routes

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'Backend is running' });
});

// Debug endpoint to check environment variables
app.get('/debug/env', (req, res) => {
    res.json({
        status: 'Environment Variables Check',
        ENABLE_WEB_SEARCH: process.env.ENABLE_WEB_SEARCH === 'true' ? '✅ TRUE' : '❌ FALSE',
        TAVILY_API_KEY_SET: process.env.TAVILY_API_KEY ? '✅ SET' : '❌ NOT SET',
        NODE_ENV: process.env.NODE_ENV,
        SERVER_HOST: process.env.SERVER_HOST,
        FRONTEND_URL: process.env.FRONTEND_URL,
        CORS_ORIGINS: process.env.CORS_ORIGINS,
        OPENROUTER_API_KEY_SET: process.env.OPENROUTER_API_KEY ? '✅ SET' : '❌ NOT SET',
        PORT: process.env.PORT
    });
});

// WebSocket connection handling
io.on('connection', (socket) => {
    console.log(`New client connected: ${socket.id}`);
    
    // Join user to their personal room with authentication
    socket.on('join-user', async (data) => {
        try {
            const { userId, token } = data;
            
            if (!userId || !token) {
                socket.emit('auth-error', { message: 'User ID and token required' });
                return;
            }

            // Verify JWT token
            const jwt = require('jsonwebtoken');
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            
            if (decoded.userId !== userId) {
                socket.emit('auth-error', { message: 'Invalid token for user' });
                return;
            }

            // Get user info
            const User = require('./models/User');
            const user = await User.findById(userId);
            
            if (!user || !user.isActive) {
                socket.emit('auth-error', { message: 'User not found or inactive' });
                return;
            }

            // Store user info in socket
            socket.userId = userId;
            socket.username = user.username;
            socket.displayName = user.displayName;

            // Join user-specific room
            socket.join(`user-${userId}`);
            
            console.log(`User ${user.username} (${user.displayName}) connected with socket ${socket.id}`);
            
            // Confirm successful authentication
            socket.emit('user-authenticated', {
                userId,
                username: user.username,
                displayName: user.displayName
            });

        } catch (error) {
            console.error('User authentication error:', error);
            socket.emit('auth-error', { message: 'Authentication failed' });
        }
    });

    // Join session room (requires authentication)
    socket.on('join-session', (sessionId) => {
        if (!socket.userId) {
            socket.emit('error', { message: 'Authentication required' });
            return;
        }

        socket.join(`session-${sessionId}`);
        socket.currentSession = sessionId;
        console.log(`User ${socket.username} joined session: ${sessionId}`);
        
        socket.emit('session-joined', { sessionId });
    });

    // Handle real-time chat messages with STRICT user context isolation
    socket.on('send-message', async (data) => {
        try {
            if (!socket.userId) {
                socket.emit('error', { message: 'Authentication required' });
                return;
            }

            const { prompt, sessionId, temperature = 0.7, max_tokens = 2000 } = data;
            const userId = socket.userId;
            
            console.log(`Processing message from user: ${socket.username} (ID: ${userId}), session: ${sessionId}`);
            
            // CRITICAL: Validate sessionId is provided
            if (!sessionId) {
                socket.emit('message-error', { 
                    error: 'Session ID is required',
                    sessionId: null 
                });
                return;
            }
            
            // CRITICAL: Validate user owns this session if it exists
            const existingSession = await ChatHistory.findOne({ sessionId: sessionId });
            if (existingSession && existingSession.userId.toString() !== userId) {
                console.error(`SECURITY BREACH: User ${userId} attempted to access session ${sessionId} belonging to ${existingSession.userId}`);
                socket.emit('message-error', { 
                    error: 'Access denied: Session does not belong to this user',
                    sessionId 
                });
                return;
            }
            
            // Emit typing indicator ONLY to this user
            socket.emit('typing', { 
                userId, 
                username: socket.username,
                isTyping: true 
            });
            
            // Get user context with STRICT user validation
            const user = await User.findById(userId);
            if (!user) {
                socket.emit('message-error', { 
                    error: 'User not found',
                    sessionId 
                });
                return;
            }
            
            // Get user memory - ONLY for this specific user
            const userMemory = await UserMemory.findOne({ userId: new mongoose.Types.ObjectId(userId) });
            
            // Get recent chat history - ONLY for this specific user and session
            const recentMessages = await ChatHistory.find({ 
                userId: new mongoose.Types.ObjectId(userId),
                sessionId: sessionId 
            })
            .sort({ timestamp: -1 })
            .limit(10)
            .select('role message timestamp');
            
            // Build context ONLY from this user's data
            const context = {
                profile: {
                    username: user.username,
                    displayName: user.displayName || user.username,
                    preferences: user.preferences || {}
                },
                memory: userMemory?.summary || '',
                recentMessages: recentMessages.reverse() // Chronological order
            };
            
            // Save user message with USER VALIDATION
            await ChatHistory.create({
                userId: new mongoose.Types.ObjectId(userId), // Convert to ObjectId
                sessionId: sessionId,
                role: 'user',
                message: prompt,
                timestamp: new Date()
            });
            
            // Call AI API with user context
            const aiResponse = await callAIAPI(prompt, context);
            
            // Save AI response with USER VALIDATION
            await ChatHistory.create({
                userId: new mongoose.Types.ObjectId(userId), // Convert to ObjectId
                sessionId: sessionId,
                role: 'assistant',
                message: aiResponse.content,
                timestamp: new Date(),
                metadata: {
                    model: aiResponse.model,
                    tokens: aiResponse.usage
                }
            });
            
            // Update user memory - ONLY for this specific user with proper truncation
            if (userMemory) {
                const recentInteraction = `User: ${prompt}\nAI: ${aiResponse.content}\n\n`;
                
                // Smart memory management - keep it under 4500 characters to leave room for new content
                if (userMemory.summary.length > 4000) {
                    // Keep only the most recent 3000 characters
                    userMemory.summary = userMemory.summary.slice(-3000);
                }
                
                // Add new interaction
                userMemory.summary += recentInteraction;
                
                // Final safety check - if still too long, truncate more aggressively
                if (userMemory.summary.length > 4900) {
                    userMemory.summary = userMemory.summary.slice(-4900);
                }
                
                userMemory.updatedAt = new Date();
                await userMemory.save();
            } else {
                // Create new memory for this user
                const initialSummary = `User: ${prompt}\nAI: ${aiResponse.content}\n\n`;
                await UserMemory.create({
                    userId: new mongoose.Types.ObjectId(userId), // Ensure ObjectId
                    summary: initialSummary,
                    contextData: {},
                    userPreferences: {},
                    updatedAt: new Date()
                });
            }
            
            // Stop typing indicator
            socket.emit('typing', { 
                userId, 
                username: socket.username,
                isTyping: false 
            });
            
            // Send response ONLY to this user
            socket.emit('message-response', {
                success: true,
                message: aiResponse.content,
                sessionId: sessionId,
                timestamp: new Date().toISOString(),
                context: {
                    hasContext: userMemory ? true : false,
                    messageCount: recentMessages.length
                },
                usage: aiResponse.usage,
                user: {
                    userId: userId,
                    username: socket.username,
                    displayName: socket.displayName
                }
            });
            
        } catch (error) {
            console.error(`WebSocket message error for user ${socket.username}:`, error);
            
            // Stop typing indicator on error
            socket.emit('typing', { 
                userId: socket.userId, 
                username: socket.username,
                isTyping: false 
            });
            
            socket.emit('message-error', { 
                error: error.message || 'Failed to process message',
                sessionId: data.sessionId || null
            });
        }
    });

    // Handle user context updates with user-specific context
    socket.on('update-context', async (data) => {
        try {
            if (!socket.userId) {
                socket.emit('error', { message: 'Authentication required' });
                return;
            }

            const { updates } = data;
            const userId = socket.userId;
            
            const UserMemory = require('./models/UserMemory');
            let userMemory = await UserMemory.findOne({ userId });
            
            if (!userMemory) {
                userMemory = await UserMemory.findOrCreateUserMemory(userId);
            }

            // Update user preferences
            if (updates.preferences) {
                Object.assign(userMemory.userPreferences, updates.preferences);
            }

            if (updates.contextData) {
                Object.assign(userMemory.contextData, updates.contextData);
            }

            userMemory.updatedAt = new Date();
            await userMemory.save();

            // Emit context update confirmation
            socket.emit('context-updated', { 
                success: true, 
                context: userMemory.getContextForAI(),
                user: {
                    userId,
                    username: socket.username
                }
            });
            
            console.log(`Context updated for user: ${socket.username}`);
            
        } catch (error) {
            console.error(`Context update error for user ${socket.username}:`, error);
            socket.emit('context-error', { error: 'Failed to update context' });
        }
    });

    // Handle session-based memory queries with user context
    socket.on('get-session-context', async (sessionId) => {
        try {
            if (!socket.userId) {
                socket.emit('error', { message: 'Authentication required' });
                return;
            }

            const ChatHistory = require('./models/ChatHistory');
            const messages = await ChatHistory.getSessionHistory(socket.userId, sessionId);
            
            socket.emit('session-context', {
                sessionId,
                messages: messages,
                messageCount: messages.length,
                user: {
                    userId: socket.userId,
                    username: socket.username
                }
            });
            
        } catch (error) {
            console.error(`Session context error for user ${socket.username}:`, error);
            socket.emit('session-context-error', { error: 'Failed to get session context' });
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        if (socket.username) {
            console.log(`User ${socket.username} (${socket.userId}) disconnected: ${socket.id}`);
        } else {
            console.log(`Anonymous client disconnected: ${socket.id}`);
        }
    });
});

server.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
    console.log(`Using model: ${process.env.MODEL}`);
    console.log(`🔍 WEB SEARCH STATUS: ${process.env.ENABLE_WEB_SEARCH === 'true' ? '✅ ENABLED' : '❌ DISABLED'}`);
    console.log(`🔍 TAVILY_API_KEY configured: ${process.env.TAVILY_API_KEY ? '✅ YES' : '❌ NO'}`);
    console.log(`🔍 Environment: NODE_ENV=${process.env.NODE_ENV}`);
    console.log('WebSocket server is ready for real-time chat!');
});
