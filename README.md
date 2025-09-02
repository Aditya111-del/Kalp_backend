# Kalp Backend API Documentation

## Overview
This is a comprehensive MongoDB + Node.js/Express system that handles user profiles and associates AI context uniquely to each user, similar to ChatGPT, Gemini, and Claude.

## Features
- ✅ User authentication with JWT
- ✅ Secure password hashing with bcrypt
- ✅ Individual user context and memory
- ✅ Chat history per user
- ✅ Usage limits and plan management
- ✅ Google OAuth integration
- ✅ Real-time WebSocket chat
- ✅ AI-powered responses with OpenRouter

## Database Schema

### User Model
```javascript
{
  _id: ObjectId,
  username: String (unique),
  email: String (unique),
  passwordHash: String,
  displayName: String,
  googleId: String (optional),
  preferences: {
    theme: String,
    aiTone: String,
    language: String,
    notifications: Boolean,
    privacy: Object
  },
  plan: String (free/premium/enterprise),
  usage: {
    messagesThisMonth: Number,
    totalMessages: Number
  },
  createdAt: Date
}
```

### ChatHistory Model
```javascript
{
  _id: ObjectId,
  userId: ObjectId (ref: User),
  sessionId: String,
  role: String (user/assistant),
  message: String,
  messageType: String,
  metadata: Object,
  timestamp: Date
}
```

### UserMemory Model
```javascript
{
  _id: ObjectId,
  userId: ObjectId (ref: User),
  summary: String,
  keyTopics: Array,
  userPreferences: Object,
  contextData: Object,
  embeddings: Array,
  conversationMetrics: Object,
  updatedAt: Date
}
```

## API Endpoints

### Authentication Routes (`/api/v2/auth`)

#### Register User
```http
POST /api/v2/auth/register
Content-Type: application/json

{
  "username": "johndoe",
  "email": "john@example.com",
  "password": "securepass123",
  "confirmPassword": "securepass123",
  "displayName": "John Doe"
}
```

**Response:**
```json
{
  "success": true,
  "message": "User registered successfully",
  "token": "jwt_token_here",
  "user": {
    "username": "johndoe",
    "email": "john@example.com",
    "displayName": "John Doe",
    "plan": "free",
    "preferences": {...}
  }
}
```

#### Login User
```http
POST /api/v2/auth/login
Content-Type: application/json

{
  "email": "john@example.com",
  "password": "securepass123"
}
```

#### Google OAuth
```http
POST /api/v2/auth/google
Content-Type: application/json

{
  "googleId": "google_user_id",
  "email": "john@example.com",
  "displayName": "John Doe",
  "avatar": "profile_image_url"
}
```

#### Get User Profile
```http
GET /api/v2/auth/profile
Authorization: Bearer {jwt_token}
```

**Response:**
```json
{
  "success": true,
  "user": {...},
  "stats": {
    "totalMessages": 156,
    "totalSessions": 23,
    "messagesThisMonth": 45,
    "canSendMessage": true
  },
  "memory": {
    "summary": "User context summary...",
    "keyTopics": [...],
    "preferences": {...}
  }
}
```

### Chat Routes (`/api/v2/chat`)

#### Send Message
```http
POST /api/v2/chat/send
Authorization: Bearer {jwt_token}
Content-Type: application/json

{
  "message": "What's the weather like today?",
  "sessionId": "optional_session_id"
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "session_uuid",
  "message": "AI response based on user context...",
  "context": {
    "hasContext": true,
    "recentMessages": 5,
    "keyTopics": ["weather", "location"]
  },
  "usage": {
    "messagesThisMonth": 46,
    "canContinue": true
  }
}
```

#### Get Chat History
```http
GET /api/v2/chat/history?sessionId=session_id&limit=50
Authorization: Bearer {jwt_token}
```

#### Get User Sessions
```http
GET /api/v2/chat/sessions
Authorization: Bearer {jwt_token}
```

#### Delete Session
```http
DELETE /api/v2/chat/session/{sessionId}
Authorization: Bearer {jwt_token}
```

## Context System

### How User Context Works

1. **Registration**: When a user registers, a `UserMemory` document is created
2. **Message Processing**: Each user message updates their memory with key topics
3. **AI Context**: Before each AI response, the system builds context including:
   - User profile and preferences
   - Conversation summary
   - Recent messages
   - Key topics and interests
4. **Personalized Responses**: AI receives full context for personalized, coherent responses

### Context Building Process

```javascript
// Example context sent to AI
{
  profile: {
    username: "johndoe",
    displayName: "John Doe",
    preferences: { aiTone: "friendly" }
  },
  memory: {
    summary: "User is a software developer interested in AI and web development",
    keyTopics: ["javascript", "react", "ai", "programming"],
    preferences: { communicationStyle: "technical" }
  },
  recentMessages: [...last 10 messages],
  crossSessionContext: [...relevant messages from other sessions]
}
```

## Security Features

- **JWT Authentication**: Secure token-based auth
- **Password Hashing**: bcrypt with salt rounds
- **Usage Limits**: Plan-based message limits
- **Input Validation**: Comprehensive request validation
- **Error Handling**: Secure error responses
- **CORS Protection**: Configurable CORS policies

## Usage Limits

| Plan | Monthly Messages | Features |
|------|------------------|----------|
| Free | 100 | Basic chat, limited history |
| Premium | 1,000 | Full features, priority support |
| Enterprise | Unlimited | All features, admin controls |

## WebSocket Events

### Client → Server
- `join-user`: Join user's personal room
- `join-session`: Join specific chat session
- `send-message`: Send real-time message
- `update-context`: Update user context

### Server → Client
- `message-response`: AI response
- `typing`: Typing indicators
- `context-updated`: Context sync
- `usage-warning`: Approaching limits

## Environment Variables

Copy `.env.example` to `.env` and configure:

```env
MONGODB_URI=mongodb://localhost:27017/kalp
JWT_SECRET=your-super-secure-jwt-secret
OPENROUTER_API_KEY=your-openrouter-api-key
MODEL=meta-llama/llama-3.1-8b-instruct:free
PORT=3002
```

## Getting Started

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Setup Environment**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Start MongoDB**
   ```bash
   # Make sure MongoDB is running
   mongod
   ```

4. **Run Development Server**
   ```bash
   npm run dev
   ```

5. **Test API**
   ```bash
   curl -X POST http://localhost:3002/api/v2/auth/register \
     -H "Content-Type: application/json" \
     -d '{"username":"test","email":"test@example.com","password":"testpass","confirmPassword":"testpass"}'
   ```

## Error Handling

All endpoints return consistent error format:

```json
{
  "success": false,
  "message": "Error description",
  "details": "Additional details (development only)"
}
```

## Rate Limiting

- **Authentication**: 5 requests per minute per IP
- **Chat**: 60 messages per hour per user
- **General**: 100 requests per 15 minutes per IP

## Data Privacy

- Users only access their own data
- Passwords are never stored in plain text
- JWT tokens expire automatically
- Optional conversation saving
- GDPR compliant data deletion

## AI Integration

The system integrates with OpenRouter for AI responses, supporting:
- Multiple AI models
- Context-aware responses
- Usage tracking
- Response caching
- Error fallbacks

---

This system provides ChatGPT-like functionality with individual user accounts, persistent memory, and secure authentication.
