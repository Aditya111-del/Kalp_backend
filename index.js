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
const { Chat, UserContext } = require('./models/Chat');
const ChatHistory = require('./models/ChatHistory');
const UserMemory = require('./models/UserMemory');
const User = require('./models/User');

// AI API function for WebSocket
async function callAIAPI(message, context) {
    const fetch = (await import('node-fetch')).default;
    
    // Build context-aware prompt
    const systemPrompt = buildSystemPrompt(context);
    const messages = buildMessageHistory(message, context);

    const requestBody = {
        model: process.env.MODEL || 'qwen/qwen3-235b-a22b:free',
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

    if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`AI API Error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();
    
    if (!data.choices || !data.choices[0]) {
        throw new Error('Invalid AI response format');
    }

    return {
        content: data.choices[0].message.content,
        model: data.model,
        usage: data.usage
    };
}

function buildSystemPrompt(context) {
    const { profile, memory } = context;
    
    let systemPrompt = `You are Kalp, an advanced AI assistant. You are helpful, knowledgeable, and engaging.

User Profile:
- Name: ${profile.displayName || profile.username}
- Preferences: ${JSON.stringify(profile.preferences)}`;

    if (memory) {
        systemPrompt += `\n\nUser Memory/Context:\n${memory}`;
    }

    systemPrompt += `\n\nInstructions:
- Provide helpful, accurate, and engaging responses
- Remember the user's context and preferences
- Be conversational and personable
- If you don't know something, admit it honestly
- Keep responses concise but comprehensive`;

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
const io = socketIo(server, {
    cors: {
        origin: ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:3001", "http://127.0.0.1:3001"],
        methods: ["GET", "POST"]
    }
});

const port = process.env.PORT || 3002;

app.use(express.json()); // Middleware to parse JSON

// Add CORS middleware for frontend integration
app.use(cors({
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:3001', 'http://127.0.0.1:3001'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization'],
    credentials: true
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
    console.log('WebSocket server is ready for real-time chat!');
});