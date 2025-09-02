# Render Deployment Configuration for Backend

## Environment Variables to Set in Render Dashboard:

### Database
MONGODB_URI=mongodb+srv://username:password@cluster0.mongodb.net/kalp_ai_chat?retryWrites=true&w=majority

### JWT & Security
JWT_SECRET=your-production-jwt-secret-key-256-bit-minimum
SESSION_SECRET=your-production-session-secret-key
BCRYPT_ROUNDS=12

### OpenRouter API
OPENROUTER_API_KEY=sk-or-v1-your-actual-openrouter-api-key-here
OPENROUTER_URL=https://openrouter.ai/api/v1/chat/completions
MODEL=qwen/qwen-2.5-72b-instruct:free
FALLBACK_MODEL=qwen/qwen-2-7b-instruct:free

### Server Configuration
PORT=10000
NODE_ENV=production
FRONTEND_URL=https://your-app-name.vercel.app

### Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

### AI Configuration
API_TIMEOUT=30000
MAX_TOKENS=2000
TEMPERATURE=0.7
FREQUENCY_PENALTY=0.1
PRESENCE_PENALTY=0.1
TOKEN_EXPIRY=7d

## Render Service Configuration:
- **Build Command:** `npm install`
- **Start Command:** `npm start`
- **Environment:** Node
- **Plan:** Free/Starter
- **Auto-Deploy:** Yes (from main branch)

## Repository Structure:
```
/Backend
├── index.js          # Main server file
├── package.json      # Dependencies
├── controllers/      # Route controllers
├── models/          # Database models
├── routes/          # API routes
├── middleware/      # Auth middleware
└── config/          # Database config
```
