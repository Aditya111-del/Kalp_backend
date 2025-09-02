const createChat = async (req, res) => {
    const fetch = (await import('node-fetch')).default;

    // OpenRouter API configuration from environment variables
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    const OPENROUTER_URL = process.env.OPENROUTER_URL;
    const MODEL = process.env.MODEL;
    
    console.log(`Current model: ${MODEL}`); // Debug log to see current model
    
    if (!OPENROUTER_API_KEY) {
        return res.status(500).json({
            success: false,
            error: 'OpenRouter API key not configured'
        });
    }
    
    // Simple, natural prompt for human-like responses
    const originalPrompt = req.body.prompt || req.body.message || "Hello";
    const enhancedPrompt = `You are KALP AI. Respond naturally and conversationally to: "${originalPrompt}"

- Keep it short and casual (1-3 sentences for simple messages)
- Sound human, not robotic
- Use minimal emojis
- Match the user's tone and energy
- NEVER include <think> tags or internal reasoning
- Only respond with the final answer, no process thoughts`;
    
    // OpenAI/OpenRouter format
    const chatFormat = {
        "model": MODEL,
        "messages": [
            {
                "role": "user",
                "content": enhancedPrompt
            }
        ],
        "stream": false,
        "temperature": req.body.temperature || 0.7,
        "max_tokens": req.body.max_tokens || 32000 // Extremely high limit for very long responses
    };

    try {
        const response = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'http://localhost:3002',
                'X-Title': 'Kalp AI Assistant'
            },
            body: JSON.stringify(chatFormat)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
        }

        // Get response as text first to handle potential JSON parsing issues
        const responseText = await response.text();
        
        let data;
        try {
            data = JSON.parse(responseText);
        } catch (parseError) {
            console.error('Failed to parse JSON response:', responseText);
            throw new Error(`Invalid JSON response: ${responseText}`);
        }
        
        // Log the full API response for debugging
        console.log('OpenRouter API Response:', JSON.stringify(data, null, 2));
        console.log('Current model:', MODEL); // Added model logging
        
        // Extract the response content from OpenRouter's response format (OpenAI compatible)
        let assistantMessage = data.choices?.[0]?.message?.content || "No response generated";
        
        // Check if response was truncated due to length limit
        const finishReason = data.choices?.[0]?.finish_reason;
        if (finishReason === 'length') {
            assistantMessage += "\n\n[Note: Response was truncated due to free tier limitations. For complete responses without limits, consider upgrading to a paid model tier.]";
        }
        
        res.json({
            success: true,
            response: assistantMessage,
            model: MODEL,
            usage: data.usage || {},
            finish_reason: finishReason,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error creating chat:', error);
        res.status(500).json({
            success: false,
            error: 'Error creating chat',
            details: error.message
        });
    }
};

const createConversation = async (req, res) => {
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

    // Extract conversation history from request body
    const { messages, temperature, max_tokens } = req.body;
    
    if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({
            success: false,
            error: 'Messages array is required'
        });
    }
    
    // OpenAI/OpenRouter format
    const chatFormat = {
        "model": MODEL,
        "messages": messages,
        "stream": false,
        "temperature": temperature || 0.7,
        "max_tokens": max_tokens || 32000 // Extremely high limit for very long responses
    };

    try {
        const response = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'http://localhost:3002',
                'X-Title': 'Kalp AI Assistant'
            },
            body: JSON.stringify(chatFormat)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
        }

        // Get response as text first to handle potential JSON parsing issues
        const responseText = await response.text();
        
        let data;
        try {
            data = JSON.parse(responseText);
        } catch (parseError) {
            console.error('Failed to parse JSON response:', responseText);
            throw new Error(`Invalid JSON response: ${responseText}`);
        }
        
        // Extract the response content from OpenRouter's response format (OpenAI compatible)
        const assistantMessage = data.choices?.[0]?.message?.content || "No response generated";
        
        res.json({
            success: true,
            response: assistantMessage,
            message: {
                role: "assistant",
                content: assistantMessage
            },
            model: MODEL,
            usage: data.usage || {},
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error creating conversation:', error);
        res.status(500).json({
            success: false,
            error: 'Error creating conversation',
            details: error.message
        });
    }
};

const getAvailableModels = async (req, res) => {
    const fetch = (await import('node-fetch')).default;
    
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    
    if (!OPENROUTER_API_KEY) {
        return res.status(500).json({
            success: false,
            error: 'OpenRouter API key not configured'
        });
    }

    try {
        const response = await fetch('https://openrouter.ai/api/v1/models', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        
        res.json({
            success: true,
            models: data.data,
            currentModel: process.env.MODEL
        });
    } catch (error) {
        console.error('Error fetching models:', error);
        res.status(500).json({
            success: false,
            error: 'Error fetching available models',
            details: error.message
        });
    }
};

const deleteChat = (req, res) => {
    res.json({
        success: true,
        message: "Chat deleted successfully"
    });
};

const updateChat = (req, res) => {
    res.json({
        success: true,
        message: "Chat updated successfully"
    });
};

const getChat = (req, res) => {
    res.json({
        success: true,
        message: "Chat retrieved successfully",
        model: process.env.MODEL,
        apiStatus: "Connected to OpenRouter"
    });
};

module.exports = {
    createChat,
    createConversation,
    getAvailableModels,
    deleteChat,
    updateChat,
    getChat
};