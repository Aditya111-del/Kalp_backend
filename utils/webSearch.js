const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

/**
 * Web Search Utility - Searches the internet for current information
 * Uses Tavily API (free tier available) or can be switched to other providers
 */

// Initialize with Tavily API (easiest free option)
// Sign up free at: https://tavily.com
async function searchWeb(query, options = {}) {
  try {
    const tavilyApiKey = process.env.TAVILY_API_KEY;
    
    if (!tavilyApiKey) {
      console.warn('⚠️ TAVILY_API_KEY not configured. Web search disabled. Set TAVILY_API_KEY in .env to enable internet access.');
      return null;
    }

    console.log(`🔍 [Tavily] Searching web for: "${query}"`);
    console.log(`🔍 [Tavily] API Key exists: ${!!tavilyApiKey}`);

    const response = await (await import('node-fetch')).default(
      'https://api.tavily.com/search',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          api_key: tavilyApiKey,
          query: query,
          max_results: options.maxResults || 5,
          include_answer: true,
          include_raw_content: false,
        })
      }
    );

    console.log(`🔍 [Tavily] Response Status: ${response.status}`);

    if (!response.ok) {
      console.error(`❌ [Tavily] API error: ${response.status} ${response.statusText}`);
      const errorBody = await response.text();
      console.error('❌ [Tavily] Error details:', errorBody);
      return null;
    }

    const data = await response.json();
    console.log(`✅ [Tavily] Response received, results count: ${data.results?.length || 0}`);
    
    if (data.results && data.results.length > 0) {
      console.log(`✅ Found ${data.results.length} search results from Tavily`);
      return {
        results: data.results,
        answer: data.answer || ''
      };
    }

    console.log('⚠️ No results found in Tavily response');
    return null;
  } catch (error) {
    console.error('❌ [Tavily] Web search error:', error.message);
    return null;
  }
}

/**
 * Alternative: DuckDuckGo Search (free, no API key needed)
 * Less reliable but works for basic searches
 */
async function searchWebDuckDuckGo(query, options = {}) {
  try {
    console.log(`🔍 Searching web (DuckDuckGo) for: "${query}"`);

    const response = await (await import('node-fetch')).default(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&kd=1`,
      {
        headers: {
          'User-Agent': 'Kalp AI Assistant'
        }
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    
    // Extract results
    const results = [];
    
    // Add instant answer if available
    if (data.Answer) {
      results.push({
        title: 'Direct Answer',
        content: data.Answer,
        source: 'DuckDuckGo'
      });
    }

    // Add related topics
    if (data.RelatedTopics && data.RelatedTopics.length > 0) {
      data.RelatedTopics.slice(0, options.maxResults || 3).forEach(topic => {
        if (topic.Text) {
          results.push({
            title: topic.FirstURL?.split('/')[2] || 'Related',
            content: topic.Text,
            url: topic.FirstURL
          });
        }
      });
    }

    if (results.length > 0) {
      console.log(`✅ Found ${results.length} results from DuckDuckGo`);
      return { results, answer: data.Answer };
    }

    return null;
  } catch (error) {
    console.error('DuckDuckGo search error:', error.message);
    return null;
  }
}

/**
 * Extract domain name from URL
 */
function getDomainName(url) {
  try {
    if (!url) return 'Source';
    const urlObj = new URL(url);
    const domain = urlObj.hostname.replace('www.', '');
    return domain.charAt(0).toUpperCase() + domain.slice(1);
  } catch (e) {
    return 'Source';
  }
}

/**
 * Format search results for inclusion in AI prompt with better source attribution
 */
function formatSearchResults(searchData) {
  if (!searchData) return '';
  
  const results = searchData.results || [];
  const answer = searchData.answer || '';

  let formatted = '\n\n🔍 SEARCH RESULTS:\n';
  formatted += ''.padEnd(60, '─') + '\n';

  if (answer) {
    formatted += `\n✨ Quick Answer: ${answer}\n`;
  }

  if (results.length > 0) {
    formatted += `\n📌 SOURCES FOR REFERENCE:\n`;
    results.forEach((result, index) => {
      // Handle both Tavily and DuckDuckGo response formats
      const title = result.title || result.name || 'Untitled';
      const url = result.url || result.link || result.href || '';
      const content = result.content || result.snippet || result.summary || '';
      const domain = getDomainName(url);
      
      formatted += `[${index + 1}] ${domain} - ${title}\n`;
      if (content) formatted += `    Summary: ${content.substring(0, 150)}...\n`;
    });
  }

  formatted += ''.padEnd(60, '─') + '\n';
  formatted += '\n🔴 CRITICAL INSTRUCTION: You MUST include this source list at the end of your response in EXACTLY this format:\n\n';
  formatted += '📌 Sources:\n';
  results.forEach((result, index) => {
    const title = result.title || result.name || 'Untitled';
    const domain = getDomainName(result.url || result.link || '');
    formatted += `[${index + 1}] ${domain} - ${title}\n`;
  });

  return formatted;
}

/**
 * Extract relevant search query from user message
 * Identifies what the user is actually asking about
 */
function extractSearchQuery(message) {
  const lowerMessage = message.toLowerCase();
  
  // Special handling for "what happened today" type queries
  if (lowerMessage.includes('what happened today') || 
      lowerMessage.includes('what\'s happening today') ||
      lowerMessage.includes('what is happening today')) {
    return 'today news events';
  }
  
  if (lowerMessage.includes('what happened') && lowerMessage.includes('today')) {
    return 'today news events';
  }
  
  // For current/trending/news queries
  if (lowerMessage.includes('trending') || lowerMessage.includes('trending now')) {
    return 'trending now';
  }
  
  if (lowerMessage.includes('latest news') || lowerMessage.includes('current news')) {
    return 'latest news today';
  }
  
  // Remove common filler words
  const fillers = ['what', 'when', 'where', 'why', 'how', 'is', 'are', 'can', 'could', 'would', 'should', 'tell', 'show', 'me', 'about', 'the', 'a', 'an', 'happened', 'happening'];
  
  const words = lowerMessage
    .split(/\s+/)
    .filter(word => !fillers.includes(word) && word.length > 2)
    .slice(0, 5); // Take first 5 meaningful words

  // If we have words, use them; otherwise use the whole message
  const query = words.length > 0 ? words.join(' ') : message;
  
  // If query is too short or empty, add "news" to it
  if (query.length < 3) {
    return `${query} news`.trim();
  }
  
  return query;
}

/**
 * Determine if a query needs web search
 * Returns true if the message asks about current events, news, or real-time info
 */
function needsWebSearch(message) {
  // If message is a question or contains analysis keywords, assume it needs current data
  const analysisKeywords = [
    // Analysis & forecasting
    'trend', 'trends', 'analysis', 'outlook', 'forecast', 'predict', 'prediction',
    'forecast', 'projection', 'estimate', 'estimate', 'what will', 'what\'s next',
    'growth', 'decline', 'performance', 'performance', 'comparison',
    
    // Market & finance
    'market', 'stock', 'price', 'crypto', 'bitcoin', 'ethereum', 'nifty', 'sensex',
    'rupee', 'dollar', 'gold', 'silver', 'oil', 'interest rate', 'inflation',
    'economy', 'gdp', 'unemployment', 'fiscal', 'monetary', 'policy',
    'rate hike', 'rate cut', 'rbi', 'fed', 'ecb', 'central bank',
    'earnings', 'revenue', 'profit', 'dividend', 'ipo', 'listing',
    
    // Time-based triggers
    'today', 'now', 'current', 'latest', 'recent', 'happening',
    'breaking', 'live', 'streaming', 'happening now', 'coming soon',
    'this week', 'this month', 'this year', 'this quarter',
    
    // News & events
    'news', 'event', 'events', 'update', 'updates', 'latest news',
    'breaking news', 'activities', 'tasks', 'going on', 'what\'s happening',
    'what is happening', 'affair', 'affairs', 'incident', 'situation',
    
    // Time queries
    'when', 'what time', 'schedule', 'release date', 'launch date',
    'date today', 'today\'s date', 'what\'s today',
    
    // Real-time info
    'weather', 'temperature', 'rainfall', 'forecast', 'score', 'game', 'match',
    'live score', 'latest match', 'sports', 'cricket', 'football',
    'status', 'current status', 'how is', 'how are',
    
    // Year references
    '2024', '2025', '2026', '2027',
    
    // General current info keywords
    'just', 'recently', 'new', 'developing', 'unfolding'
  ];

  const messageLower = message.toLowerCase();
  const containsKeyword = analysisKeywords.some(keyword => messageLower.includes(keyword));
  
  // Also trigger if it's a question mark question (more likely to need current info)
  const isQuestion = message.includes('?');
  
  return containsKeyword || (isQuestion && message.length > 10);
}

module.exports = {
  searchWeb,
  searchWebDuckDuckGo,
  formatSearchResults,
  extractSearchQuery,
  needsWebSearch
};
