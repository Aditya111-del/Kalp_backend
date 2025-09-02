# 🚀 Render Environment Setup Guide

# � Render Environment Setup Guide - ESSENTIAL VARIABLES ONLY

## 📋 CRITICAL Environment Variables for Render

Add these **EXACT** environment variables in your Render dashboard (Settings → Environment):

### 🗄️ Database Configuration
```
MONGODB_URI=mongodb+srv://adityasalgotra6_db_user:0SyOTNtzVC63eZjp@cluster0.xhjzirn.mongodb.net/kalp_ai_chat?retryWrites=true&w=majority&appName=Cluster0
```

### 🤖 OpenRouter AI API
```
OPENROUTER_API_KEY=sk-or-v1-your-actual-openrouter-api-key-here
OPENROUTER_URL=https://openrouter.ai/api/v1/chat/completions  
OPENROUTER_MODELS_URL=https://openrouter.ai/api/v1/models
MODEL=qwen/qwen-2.5-72b-instruct:free
FALLBACK_MODEL=qwen/qwen-2-7b-instruct:free
```

### 🔐 Security & Authentication
```
JWT_SECRET=KalpAI2025!SuperSecureJWTKey#ProductionReady$256Bit
JWT_EXPIRE=7d
SESSION_SECRET=KalpAI2025!SuperSecureSessionKey#ProductionReady$256Bit
BCRYPT_ROUNDS=12
```

### 🌐 Server & CORS Configuration
```
PORT=10000
NODE_ENV=production
SERVER_HOST=0.0.0.0
FRONTEND_URL=https://kalp-ai.vercel.app
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,https://kalp-ai.vercel.app
HTTP_REFERER=https://kalp.ai
```

### ⚙️ API & Performance
```
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
API_TIMEOUT=60000
MAX_TOKENS=2000
TEMPERATURE=0.7
FREQUENCY_PENALTY=0.1
PRESENCE_PENALTY=0.1
TOP_P=0.9
MAX_RESPONSE_TOKENS=2000
```

### 📊 Production Settings
```
LOG_LEVEL=info
ENABLE_LOGS=true
COMPRESSION_ENABLED=true
HELMET_ENABLED=true
TRUST_PROXY=true
```

## 🔧 Render Deployment Steps

1. **Create New Web Service**
   - Go to [Render Dashboard](https://dashboard.render.com)
   - Click "New" → "Web Service"
   - Connect your GitHub repository

2. **Configuration Settings**
   ```
   Name: kalp-backend
   Environment: Node
   Branch: main
   Build Command: npm install
   Start Command: npm start
   ```

3. **Add Environment Variables**
   - Go to "Environment" tab
   - Add ALL variables listed above
   - Make sure there are NO spaces around the `=` signs
   - Click "Save Changes"

4. **Deploy**
   - Click "Deploy Latest Commit"
   - Monitor logs for successful connection

## ✅ Verification Checklist

After deployment, check these in the Render logs:

- [ ] `✅ MongoDB Connected Successfully!`
- [ ] `Server is running on http://localhost:10000`
- [ ] `Using model: qwen/qwen-2.5-72b-instruct:free`
- [ ] `WebSocket server is ready for real-time chat!`
- [ ] No MongoDB connection errors
- [ ] No duplicate index warnings

## 🚨 Common Issues & Solutions

### Issue: `connect ECONNREFUSED ::1:27017`
**Solution**: MongoDB URI not set correctly
- Check `MONGODB_URI` environment variable
- Ensure no typos in the connection string
- Verify MongoDB Atlas cluster is accessible

### Issue: `Duplicate schema index warnings`
**Solution**: Fixed in latest code
- Models now use compound indexes only
- Individual `index: true` properties removed

### Issue: `Environment variables not loading`
**Solution**: Check Render dashboard
- Verify all variables are set in Render dashboard
- No extra spaces around variable names
- Redeploy after adding variables

### Issue: CORS errors
**Solution**: Update CORS settings
- Set `FRONTEND_URL` to your actual Vercel domain
- Update `CORS_ORIGIN` to match frontend URL

## 📞 Support

If you encounter issues:

1. **Check Render Logs**
   ```
   Go to your service → "Logs" tab
   Look for specific error messages
   ```

2. **Verify Environment Variables**
   ```
   Go to "Environment" tab
   Ensure all variables are present
   Check for typos or extra spaces
   ```

3. **Test MongoDB Connection**
   ```bash
   # Use MongoDB Compass or Studio 3T to test your connection string
   mongodb+srv://kalpai:KalpAI2025!@cluster0.mongodb.net/kalp_ai_chat
   ```

4. **Validate OpenRouter API**
   ```bash
   # Test your API key at https://openrouter.ai/docs
   ```

Your backend should now connect successfully to MongoDB Atlas and be ready for production! 🎉
