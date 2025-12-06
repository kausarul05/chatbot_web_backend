import express from 'express'
import dotenv from 'dotenv'
import cors from 'cors'
import connectDB from './config/db.js'
import userRoutes from './routes/userRoutes.js'
import { notFound, errorHandler } from './middleware/errorMiddleware.js'
import authRoutes from './routes/authRoutes.js'
import axios from 'axios'

dotenv.config()
connectDB()

const app = express()

// CORS configuration - Allow dev.chatbot24.ai
const allowedOrigins = [
  "https://dev.chatbot24.ai",
  "http://localhost:3000",
  "http://localhost:5000",
];

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);
      
      if (allowedOrigins.indexOf(origin) === -1) {
        const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
        return callback(new Error(msg), false);
      }
      return callback(null, true);
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
      
      chatbotSessions[sessionId] = {
        email: email,
        accessToken: loginResponse.data.accessToken,
        loginToken: loginResponse.data.loginToken,
        guid: loginResponse.data.guid,
        role: loginResponse.data.role,
        domains: loginResponse.data.domains,
        createdAt: Date.now(),
        fullData: loginResponse.data
      };

      console.log(`Session created: ${sessionId}`);
      
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

// **2. SIMPLE Dashboard Embedding Solution**
app.get('/api/proxy/chatbot/embed-dashboard', async (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    
    console.log(`Embed dashboard request for session: ${sessionId}`);
    
    if (!sessionId || !chatbotSessions[sessionId]) {
      return res.status(401).json({ error: 'Session expired' });
    }

    const session = chatbotSessions[sessionId];
    
    // Create a simple HTML page that tries to embed the dashboard
    const embedHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Chatbot24 Dashboard</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body, html {
            margin: 0;
            padding: 0;
            height: 100%;
            overflow: hidden;
            background: #0A0F1C;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          }
          
          .container {
            height: 100vh;
            display: flex;
            flex-direction: column;
          }
          
          .header {
            background: #1A2028;
            padding: 15px 20px;
            border-bottom: 1px solid #2D3748;
            display: flex;
            justify-content: space-between;
            align-items: center;
            color: white;
          }
          
          .header h1 {
            margin: 0;
            font-size: 18px;
            font-weight: 600;
          }
          
          .btn {
            padding: 8px 16px;
            border-radius: 6px;
            border: none;
            font-weight: 500;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.2s;
            background: #60A5FB;
            color: white;
          }
          
          .btn:hover {
            background: #3B82F6;
          }
          
          .error {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            padding: 40px;
            text-align: center;
            color: white;
          }
          
          .error h2 {
            color: #F87171;
            margin-bottom: 20px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Chatbot24.ai Embedded Dashboard</h1>
            <button class="btn" onclick="openInNewTab()">Open in New Tab</button>
          </div>
          
          <!-- Try to embed the dashboard directly -->
          <iframe 
            id="dashboardFrame"
            src="https://dashboard.chatbot24.ai/app"
            style="width: 100%; height: calc(100vh - 60px); border: none;"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
            allow="autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen
          ></iframe>
        </div>
        
        <script>
          function openInNewTab() {
            window.open('https://dashboard.chatbot24.ai/app', '_blank');
          }
          
          // Listen for iframe messages
          window.addEventListener('message', function(event) {
            console.log('Message from iframe:', event.data);
          });
          
          // Check if iframe loads successfully
          document.getElementById('dashboardFrame').onload = function() {
            console.log('Dashboard iframe loaded');
          };
          
          document.getElementById('dashboardFrame').onerror = function() {
            console.error('Iframe failed to load');
            document.body.innerHTML = \`
              <div class="error">
                <h2>Cannot Embed Dashboard</h2>
                <p>The dashboard cannot be embedded due to security restrictions.</p>
                <button class="btn" onclick="openInNewTab()">Open in New Tab Instead</button>
              </div>
            \`;
          };
        </script>
      </body>
      </html>
    `;
    
    res.setHeader('Content-Type', 'text/html');
    res.send(embedHtml);

  } catch (error) {
    console.error('Embed dashboard error:', error.message);
    res.status(500).send('Error loading dashboard');
  }
});

// **3. Test endpoint to check if embedding works**
app.get('/api/proxy/chatbot/test-embed', (req, res) => {
  const testHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Test Embed</title>
      <style>
        body { margin: 0; padding: 20px; font-family: Arial; }
        .frame-container { margin: 20px 0; }
        iframe { width: 100%; height: 500px; border: 2px solid #ccc; }
      </style>
    </head>
    <body>
      <h1>Test Embedding Different URLs</h1>
      
      <div class="frame-container">
        <h3>Test 1: dashboard.chatbot24.ai/app</h3>
        <iframe src="https://dashboard.chatbot24.ai/app"></iframe>
      </div>
      
      <div class="frame-container">
        <h3>Test 2: dashboard.chatbot24.ai/settings/live-chat-integrations</h3>
        <iframe src="https://dashboard.chatbot24.ai/settings/live-chat-integrations"></iframe>
      </div>
      
      <div class="frame-container">
        <h3>Test 3: Regular website (should work)</h3>
        <iframe src="https://example.com"></iframe>
      </div>
      
      <script>
        // Check which iframes load successfully
        document.querySelectorAll('iframe').forEach((iframe, index) => {
          iframe.onload = function() {
            console.log(\`Iframe \${index + 1} loaded successfully\`);
          };
          iframe.onerror = function() {
            console.log(\`Iframe \${index + 1} failed to load\`);
          };
        });
      </script>
    </body>
    </html>
  `;
  
  res.setHeader('Content-Type', 'text/html');
  res.send(testHtml);
});

// **4. Get auth data endpoint**
app.get('/api/proxy/chatbot/auth-data', async (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    
    if (!sessionId || !chatbotSessions[sessionId]) {
      return res.status(401).json({ error: 'Session expired' });
    }
    
    const session = chatbotSessions[sessionId];
    
    res.json({
      success: true,
      accessToken: session.accessToken,
      loginToken: session.loginToken,
      guid: session.guid,
      email: session.email
    });
    
  } catch (error) {
    console.error('Get auth data error:', error);
    res.status(500).json({ error: error.message });
  }
});

// **5. Cleanup old sessions**
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

// **6. Log all requests**
app.use((req, res, next) => {
  console.log(`📨 ${req.method} ${req.originalUrl}`);
  next();
});

// Your existing routes
app.use('/api/users', userRoutes);
app.use('/api/auth', authRoutes);

app.get('/', (req, res) => {
  res.send('API is running with chatbot proxy support...');
});

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));