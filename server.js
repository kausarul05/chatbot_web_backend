import express from 'express'
import dotenv from 'dotenv'
import cors from 'cors'
import connectDB from './config/db.js'
import userRoutes from './routes/userRoutes.js'
import { notFound, errorHandler } from './middleware/errorMiddleware.js'
import authRoutes from './routes/authRoutes.js'
import axios from 'axios'
import { createProxyMiddleware } from 'http-proxy-middleware'

dotenv.config()
connectDB()

const app = express()

// CORS configuration
const allowedOrigins = [
  "http://localhost:3000",
  "https://dev.chatbot24.ai",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("CORS not allowed for this origin"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "X-Chatbot-Session-Id",
      "Accept",
      "Origin",
      "Referer",
      "User-Agent"
    ]
  })
);

app.use(express.json())

// In-memory session store
const chatbotSessions = {}

// **1. Enhanced Proxy Login Endpoint**
app.post('/api/proxy/chatbot/login-full', async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log(`Full login for: ${email}`);

    // Login to chatbot24.ai
    const loginResponse = await axios.post('https://api.chatbot24.ai/v1/auth/login', {
      device: {
        type: "browser",
        appVersion: "1.8.45",
        language: "en-GB",
        platform: "Win32",
        userAgent: req.headers['user-agent'] || "Mozilla/5.0",
        deviceID: `device_${Date.now()}`
      },
      password: password,
      timezone: "Asia/Dhaka",
      username: email
    });

    if (loginResponse.data.accessToken) {
      // Create session in our system
      const sessionId = `chatbot_${Date.now()}_${Math.random().toString(36).substr(2)}`;
      
      // Get cookies from response headers
      const responseCookies = loginResponse.headers['set-cookie'];
      let cookiesArray = [];
      
      if (responseCookies) {
        if (Array.isArray(responseCookies)) {
          cookiesArray = responseCookies;
        } else {
          cookiesArray = [responseCookies];
        }
      }
      
      chatbotSessions[sessionId] = {
        email: email,
        accessToken: loginResponse.data.accessToken,
        loginToken: loginResponse.data.loginToken,
        guid: loginResponse.data.guid,
        role: loginResponse.data.role,
        domains: loginResponse.data.domains,
        is_agency: loginResponse.data.is_agency,
        client_limit: loginResponse.data.client_limit,
        widgetUID: loginResponse.data.widgetUID,
        defaultWorkspace: loginResponse.data.defaultWorkspace,
        workspaces: loginResponse.data.workspaces,
        tariff: loginResponse.data.tariff,
        tfa_required: loginResponse.data.tfa_required,
        createdAt: Date.now(),
        cookies: cookiesArray,
        rawCookies: responseCookies
      };

      console.log(`Session created: ${sessionId}`);
      console.log(`Cookies received: ${cookiesArray.length}`);
      
      res.json({
        success: true,
        sessionId: sessionId,
        accessToken: loginResponse.data.accessToken,
        loginToken: loginResponse.data.loginToken,
        guid: loginResponse.data.guid,
        email: email,
        fullData: loginResponse.data,
        message: 'Login successful'
      });
    } else {
      throw new Error("No access token received");
    }
  } catch (error) {
    console.error("Full login error:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data
    });
  }
});

// **2. Universal Proxy Handler for Chatbot24.ai**
app.use('/api/proxy/chatbot/*', async (req, res, next) => {
  try {
    const sessionId = req.headers['x-chatbot-session-id'] || req.query.sessionId;
    
    if (!sessionId || !chatbotSessions[sessionId]) {
      console.log('No valid session found');
      return res.status(401).json({ error: "Session expired" });
    }

    const session = chatbotSessions[sessionId];
    req.chatbotSession = session;
    next();
  } catch (error) {
    console.error("Session validation error:", error);
    res.status(401).json({ error: "Authentication failed" });
  }
});

// **3. Dynamic Proxy for ALL chatbot24.ai routes**
app.all('/api/proxy/chatbot/dashboard/*', async (req, res) => {
  try {
    const session = req.chatbotSession;
    const originalUrl = req.originalUrl;
    
    // Extract the path after /dashboard/
    const pathMatch = originalUrl.match(/\/api\/proxy\/chatbot\/dashboard\/(.+)/);
    const targetPath = pathMatch ? pathMatch[1] : '';
    
    // Determine target URL
    let targetUrl;
    if (targetPath.startsWith('api/') || targetPath.startsWith('v1/') || targetPath.startsWith('v2/')) {
      targetUrl = `https://api.chatbot24.ai/${targetPath}`;
    } else {
      targetUrl = `https://dashboard.chatbot24.ai/${targetPath}`;
    }
    
    console.log(`Proxying: ${req.method} ${targetUrl}`);
    
    // Prepare headers
    const headers = {
      'Authorization': `Bearer ${session.accessToken}`,
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
      'Accept': req.headers['accept'] || '*/*',
      'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.5',
      'Accept-Encoding': req.headers['accept-encoding'] || 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Referer': 'https://dashboard.chatbot24.ai/',
      'Origin': 'https://dashboard.chatbot24.ai',
      'Sec-Fetch-Dest': req.headers['sec-fetch-dest'] || 'empty',
      'Sec-Fetch-Mode': req.headers['sec-fetch-mode'] || 'cors',
      'Sec-Fetch-Site': req.headers['sec-fetch-site'] || 'same-origin'
    };

    // Add cookies if available
    if (session.cookies && session.cookies.length > 0) {
      headers['Cookie'] = Array.isArray(session.cookies) 
        ? session.cookies.join('; ') 
        : session.cookies;
    }

    // Copy specific headers from original request
    const headersToCopy = [
      'Content-Type',
      'Content-Length',
      'If-None-Match',
      'If-Modified-Since',
      'Cache-Control'
    ];
    
    headersToCopy.forEach(header => {
      if (req.headers[header.toLowerCase()]) {
        headers[header] = req.headers[header.toLowerCase()];
      }
    });

    // Make the proxied request
    const axiosConfig = {
      method: req.method,
      url: targetUrl,
      headers: headers,
      responseType: 'arraybuffer', // Handle all types of responses
      validateStatus: null, // Don't throw on non-2xx
      maxRedirects: 5,
      timeout: 30000,
      data: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined
    };

    const response = await axios(axiosConfig);

    console.log(`Proxy response: ${response.status} ${targetUrl}`);

    // Update cookies if new ones were set
    const newCookies = response.headers['set-cookie'];
    if (newCookies) {
      chatbotSessions[req.query.sessionId].cookies = Array.isArray(newCookies) 
        ? newCookies 
        : [newCookies];
    }

    // Forward response headers (except security headers)
    Object.keys(response.headers).forEach(key => {
      // Skip security headers that might block iframe
      if (!['x-frame-options', 'content-security-policy'].includes(key.toLowerCase())) {
        res.setHeader(key, response.headers[key]);
      }
    });

    // Set CORS headers for iframe
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    // Send the response
    res.status(response.status);
    res.send(response.data);

  } catch (error) {
    console.error("Dynamic proxy error:", error.message);
    res.status(500).json({ 
      error: "Proxy error", 
      message: error.message,
      url: req.originalUrl 
    });
  }
});

// **4. Main Dashboard Page Proxy**
app.get('/api/proxy/chatbot/page/:path*', async (req, res) => {
  try {
    const session = req.chatbotSession;
    const path = req.params.path || 'settings/live-chat-integrations';
    const targetUrl = `https://dashboard.chatbot24.ai/${path}${req.params[0] || ''}`;
    
    console.log(`Fetching main page: ${targetUrl}`);

    // Prepare headers
    const headers = {
      'Authorization': `Bearer ${session.accessToken}`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Referer': 'https://dashboard.chatbot24.ai/',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0'
    };

    // Add cookies if available
    if (session.cookies && session.cookies.length > 0) {
      headers['Cookie'] = Array.isArray(session.cookies) 
        ? session.cookies.join('; ') 
        : session.cookies;
    }

    // Fetch the page
    const response = await axios.get(targetUrl, {
      headers: headers,
      responseType: 'text',
      validateStatus: null,
      maxRedirects: 5,
      timeout: 30000
    });

    console.log(`Page response: ${response.status}`);

    // Check for redirect to login
    const responseUrl = response.request?.res?.responseUrl || '';
    const responseData = response.data || '';
    
    if (response.status === 302 || 
        response.status === 401 || 
        response.status === 403 ||
        responseUrl.includes('login') ||
        responseData.includes('login') || 
        responseData.includes('Login') ||
        responseData.includes('sign in')) {
      
      console.log("Redirected to login, session expired");
      return res.status(401).json({ error: "Session expired" });
    }

    // Modify HTML to work in iframe
    let html = responseData;
    
    // Fix base URL
    if (!html.includes('<base href=')) {
      html = html.replace(
        /<head>/i,
        `<head>\n<base href="https://dashboard.chatbot24.ai/">`
      );
    }
    
    // Fix ALL relative URLs to absolute URLs
    const replacements = [
      // src attributes
      { pattern: /src="\//g, replacement: 'src="https://dashboard.chatbot24.ai/' },
      { pattern: /src='\//g, replacement: "src='https://dashboard.chatbot24.ai/" },
      { pattern: /src="\.\//g, replacement: 'src="https://dashboard.chatbot24.ai/' },
      
      // href attributes
      { pattern: /href="\//g, replacement: 'href="https://dashboard.chatbot24.ai/' },
      { pattern: /href='\//g, replacement: "href='https://dashboard.chatbot24.ai/" },
      { pattern: /href="\.\//g, replacement: 'href="https://dashboard.chatbot24.ai/' },
      
      // CSS URLs
      { pattern: /url\(['"]?\//g, replacement: 'url(https://dashboard.chatbot24.ai/' },
      { pattern: /url\(['"]?\.\//g, replacement: 'url(https://dashboard.chatbot24.ai/' },
      
      // Action attributes
      { pattern: /action="\//g, replacement: 'action="https://dashboard.chatbot24.ai/' },
      
      // API endpoints in scripts
      { pattern: /(\/api\/v\d\/)/g, replacement: 'https://api.chatbot24.ai/$1' },
      { pattern: /('\/api\/)/g, replacement: "'https://api.chatbot24.ai/" },
      { pattern: /("\/api\/)/g, replacement: '"https://api.chatbot24.ai/' },
      
      // Rewrite internal links to go through our proxy
      { pattern: /href="https:\/\/dashboard\.chatbot24\.ai\/([^"]*)"/g, 
        replacement: (match, p1) => `href="/api/proxy/chatbot/dashboard/${p1}?sessionId=${req.query.sessionId}"` 
      },
      
      // Rewrite API calls to go through our proxy
      { pattern: /https:\/\/api\.chatbot24\.ai\/(v\d\/[^"']*)/g, 
        replacement: (match, p1) => `/api/proxy/chatbot/dashboard/api/${p1}?sessionId=${req.query.sessionId}`
      }
    ];
    
    replacements.forEach(({ pattern, replacement }) => {
      html = html.replace(pattern, replacement);
    });

    // Remove problematic headers
    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    
    // Set headers
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    res.send(html);

  } catch (error) {
    console.error("Page proxy error:", error.message);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Error</title>
        <style>
          body { font-family: Arial; padding: 40px; text-align: center; }
          .error { color: #dc2626; margin: 20px 0; }
          button { background: #60A5FB; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; margin: 10px; }
        </style>
      </head>
      <body>
        <h2>Error Loading Page</h2>
        <div class="error">${error.message}</div>
        <button onclick="window.location.reload()">Retry</button>
        <button onclick="window.parent.postMessage({ type: 'SESSION_EXPIRED' }, '*')">Go to Login</button>
      </body>
      </html>
    `);
  }
});

// **5. Debug Endpoint**
app.get('/api/proxy/chatbot/debug-session/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  
  if (!sessionId || !chatbotSessions[sessionId]) {
    return res.json({
      exists: false,
      message: 'Session not found'
    });
  }
  
  const session = chatbotSessions[sessionId];
  
  res.json({
    exists: true,
    sessionId: sessionId,
    email: session.email,
    accessToken: session.accessToken ? 'Present' : 'Missing',
    cookies: {
      count: session.cookies?.length || 0,
      sample: session.cookies?.[0]?.substring(0, 50) || 'No cookies'
    },
    createdAt: new Date(session.createdAt).toLocaleString(),
    age: Math.floor((Date.now() - session.createdAt) / 1000) + ' seconds'
  });
});

// **6. Cleanup old sessions**
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;

  for (const [sessionId, session] of Object.entries(chatbotSessions)) {
    if (now - session.createdAt > 24 * 60 * 60 * 1000) {
      delete chatbotSessions[sessionId];
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.log(`Cleaned up ${cleaned} expired sessions`);
  }
}, 60 * 60 * 1000);

// Your existing routes
app.use('/api/users', userRoutes);
app.use('/api/auth', authRoutes);

app.get('/', (req, res) => {
  res.send('API is running with chatbot proxy support...');
});

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));