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

// CORS configuration
app.use(
  cors({
    origin: 'http://localhost:3000',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-Chatbot-Session-Id'
    ]
  })
)

app.use(express.json())

// In-memory session store (for development)
const chatbotSessions = {}

// **1. Chatbot Login Endpoint**
app.post('/api/proxy/chatbot/login', async (req, res) => {
  try {
    const { email, password } = req.body

    console.log(`Chatbot login attempt for: ${email}`)

    // Get device info
    const deviceInfo = {
      type: 'browser',
      appVersion: '1.8.45',
      language: 'en-GB',
      platform: 'Win32',
      userAgent: 'Mozilla/5.0',
      deviceID: `device_${Date.now()}`
    }

    const timezone = 'Asia/Dhaka'

    // Make login request to chatbot API
    const response = await axios.post(
      'https://api.chatbot24.ai/v1/auth/login',
      {
        device: deviceInfo,
        password: password,
        timezone: timezone,
        username: email
      }
    )

    console.log('Chatbot API response status:', response.status)

    if (response.data && response.data.accessToken) {
      // Generate session ID
      const sessionId = `chatbot_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2)}`

      // Store session
      chatbotSessions[sessionId] = {
        email: email,
        accessToken: response.data.accessToken,
        createdAt: Date.now(),
        userData: response.data.user || {}
      }

      console.log(`Session created: ${sessionId} for ${email}`)
      console.log(
        `Total sessions in memory: ${Object.keys(chatbotSessions).length}`
      )

      return res.json({
        success: true,
        sessionId: sessionId,
        accessToken: response.data.accessToken,
        email: email,
        message: 'Login successful'
      })
    } else {
      throw new Error('No access token received')
    }
  } catch (error) {
    console.error('Chatbot login error:', error.response?.data || error.message)

    if (error.response) {
      return res.status(error.response.status).json({
        success: false,
        error: error.response.data.error || 'Authentication failed'
      })
    }

    return res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

// **2. Session Check Endpoint (USES HEADER INSTEAD OF COOKIES)**
// **SIMPLER VERSION: Session Check Endpoint**
app.get('/api/proxy/chatbot/session', async (req, res) => {
  try {
    // Get session ID from header
    const sessionId = req.headers['x-chatbot-session-id']

    console.log('Session check for ID:', sessionId)

    if (!sessionId || !chatbotSessions[sessionId]) {
      console.log('Session not found')
      return res.json({ authenticated: false })
    }

    const sessionData = chatbotSessions[sessionId]

    // Simple check - session exists and isn't expired
    const isExpired = Date.now() - sessionData.createdAt > 24 * 60 * 60 * 1000

    if (isExpired) {
      delete chatbotSessions[sessionId]
      console.log('Session expired')
      return res.json({ authenticated: false })
    }

    // Session is valid
    console.log('Session is valid')
    return res.json({
      authenticated: true,
      email: sessionData.email,
      sessionId: sessionId,
      accessToken: sessionData.accessToken,
      createdAt: sessionData.createdAt
    })
  } catch (error) {
    console.error('Session check error:', error.message)
    return res.json({ authenticated: false })
  }
})

// **3. Refresh Session Endpoint**
// **Fixed Refresh Session Endpoint**
app.post('/api/proxy/chatbot/refresh', async (req, res) => {
  try {
    const { email, password, sessionId } = req.body

    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, error: 'Email and password required' })
    }

    // Create new session
    const response = await axios.post(
      'https://api.chatbot24.ai/v1/auth/login',
      {
        device: {
          type: 'browser',
          appVersion: '1.8.45',
          language: 'en-GB',
          platform: 'Win32',
          userAgent: 'Mozilla/5.0',
          deviceID: `device_${Date.now()}`
        },
        password: password,
        timezone: 'Asia/Dhaka',
        username: email
      }
    )

    if (response.data.accessToken) {
      const newSessionId =
        sessionId ||
        `chatbot_${Date.now()}_${Math.random().toString(36).substr(2)}`

      // Update or create session
      chatbotSessions[newSessionId] = {
        email: email,
        accessToken: response.data.accessToken,
        createdAt: Date.now(),
        userData: response.data.user || {}
      }

      console.log(
        `Session ${sessionId ? 'updated' : 'created'}: ${newSessionId}`
      )

      return res.json({
        success: true,
        sessionId: newSessionId,
        accessToken: response.data.accessToken,
        message: 'Session refreshed'
      })
    } else {
      return res
        .status(400)
        .json({ success: false, error: 'No access token received' })
    }
  } catch (error) {
    console.error('Refresh error:', error.response?.data || error.message)
    return res.status(500).json({
      success: false,
      error: 'Failed to refresh session',
      details: error.response?.data
    })
  }
})

// Add this endpoint to debug
app.get("/api/proxy/chatbot/debug/sessions", (req, res) => {
  const sessions = Object.keys(chatbotSessions).map(id => ({
    id,
    email: chatbotSessions[id].email,
    createdAt: new Date(chatbotSessions[id].createdAt).toLocaleString(),
    age: Math.floor((Date.now() - chatbotSessions[id].createdAt) / 1000) + " seconds",
    accessToken: chatbotSessions[id].accessToken ? "Present" : "Missing"
  }));
  
  res.json({
    totalSessions: sessions.length,
    sessions: sessions,
    memoryUsage: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`
  });
});

// **4. Dashboard Proxy**
app.get('/api/proxy/chatbot/dashboard', async (req, res) => {
  try {
    // Get session ID from query parameter
    const sessionId = req.query.sessionId

    console.log('Dashboard request. Session ID:', sessionId)

    if (!sessionId || !chatbotSessions[sessionId]) {
      return res.status(401).send(`
        <html>
          <body style="font-family: Arial; padding: 40px; text-align: center;">
            <h2>Session Expired</h2>
            <p>Please login again</p>
            <button onclick="window.location.href='/login'">Go to Login</button>
          </body>
        </html>
      `)
    }

    const session = chatbotSessions[sessionId]

    // Fetch dashboard page
    const dashboardResponse = await axios.get(
      'https://dashboard.chatbot24.ai/settings/live-chat-integrations',
      {
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'User-Agent': 'Mozilla/5.0'
        }
      }
    )

    let html = dashboardResponse.data

    // Modify HTML to work in iframe
    html = html.replace(
      /<head>/,
      `<head><base href="https://dashboard.chatbot24.ai/">`
    )

    // Remove problematic headers
    res.removeHeader('X-Frame-Options')
    res.removeHeader('Content-Security-Policy')

    res.setHeader('Content-Type', 'text/html')
    res.send(html)
  } catch (error) {
    console.error('Dashboard proxy error:', error.message)
    res.status(500).send('Failed to load dashboard')
  }
})

// **Auto-login to Dashboard Endpoint**
app.get("/api/proxy/chatbot/auto-login", async (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    
    if (!sessionId || !chatbotSessions[sessionId]) {
      return res.status(401).send(`
        <html>
          <body style="font-family: Arial; padding: 40px; text-align: center;">
            <h2>Session Expired</h2>
            <p>Please login again</p>
            <button onclick="window.location.href='/login'">Go to Login</button>
          </body>
        </html>
      `);
    }

    const session = chatbotSessions[sessionId];
    const accessToken = session.accessToken;
    const email = session.email;
    
    // Create an HTML page that auto-submits login form
    const autoLoginPage = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Auto-Login to Chatbot Dashboard</title>
        <meta http-equiv="refresh" content="3;url=https://dashboard.chatbot24.ai/settings/live-chat-integrations">
        <style>
          body {
            font-family: Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: #0A0F1C;
            color: white;
          }
          .container {
            text-align: center;
            padding: 40px;
            background: #1A2028;
            border-radius: 10px;
            border: 1px solid #2D3748;
            max-width: 500px;
          }
          .spinner {
            border: 4px solid #2D3748;
            border-top: 4px solid #60A5FB;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto 20px;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="spinner"></div>
          <h2>Auto-Login in Progress</h2>
          <p>Logging you into chatbot24.ai dashboard...</p>
          <p>You will be redirected in 3 seconds.</p>
          <p><small>If not redirected, <a href="https://dashboard.chatbot24.ai/settings/live-chat-integrations" target="_blank">click here</a></small></p>
        </div>
        
        <!-- Hidden iframe for auto-login -->
        <iframe id="loginFrame" style="display: none;"></iframe>
        
        <script>
          // Method 1: Try to set cookie and redirect
          document.cookie = "auth_token=${accessToken}; path=/; domain=.chatbot24.ai; max-age=86400; SameSite=None; Secure";
          
          // Method 2: Try to post login form
          setTimeout(() => {
            const form = document.createElement('form');
            form.method = 'POST';
            form.action = 'https://dashboard.chatbot24.ai/api/auth/login';
            form.target = 'loginFrame';
            
            const tokenInput = document.createElement('input');
            tokenInput.type = 'hidden';
            tokenInput.name = 'token';
            tokenInput.value = '${accessToken}';
            form.appendChild(tokenInput);
            
            const emailInput = document.createElement('input');
            emailInput.type = 'hidden';
            emailInput.name = 'email';
            emailInput.value = '${email}';
            form.appendChild(emailInput);
            
            document.body.appendChild(form);
            form.submit();
            
            // Redirect after form submission
            setTimeout(() => {
              window.location.href = 'https://dashboard.chatbot24.ai/settings/live-chat-integrations';
            }, 1000);
          }, 500);
        </script>
      </body>
      </html>
    `;
    
    res.setHeader('Content-Type', 'text/html');
    res.send(autoLoginPage);

  } catch (error) {
    console.error("Auto-login error:", error.message);
    res.status(500).send("Auto-login failed");
  }
});

// **Dashboard with Auto-Login Redirect**
app.get("/api/proxy/chatbot/dashboard-auto", async (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    
    if (!sessionId || !chatbotSessions[sessionId]) {
      return res.redirect('/login');
    }

    const session = chatbotSessions[sessionId];
    
    // Redirect to auto-login page
    res.redirect(`/api/proxy/chatbot/auto-login?sessionId=${sessionId}`);

  } catch (error) {
    console.error("Dashboard auto error:", error.message);
    res.status(500).send("Failed to load dashboard");
  }
});

// **NEW: Chatbot Auto-Login & Redirect Endpoint**
app.get("/api/proxy/chatbot/auto-login-redirect", async (req, res) => {
  try {
    const { email, password } = req.query;
    
    if (!email || !password) {
      return res.status(400).send("Email and password required");
    }

    console.log(`Auto-login attempt for: ${email}`);

    // Generate device ID
    const deviceID = `device_${Date.now()}_${Math.random().toString(36).substr(2)}`;
    
    // Login to chatbot24.ai
    const loginResponse = await axios.post('https://api.chatbot24.ai/v1/auth/login', {
      device: {
        type: "browser",
        appVersion: "1.8.45",
        language: "en-GB",
        platform: "Win32",
        userAgent: "Mozilla/5.0",
        deviceID: deviceID
      },
      password: password,
      timezone: "Asia/Dhaka",
      username: email
    });

    console.log("Chatbot login response:", loginResponse.status);

    if (loginResponse.data.accessToken) {
      const accessToken = loginResponse.data.accessToken;
      
      // **Create an HTML page that sets cookies and redirects**
      const autoLoginHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Redirecting to Chatbot Dashboard</title>
          <script>
            // Store token in localStorage and cookies
            localStorage.setItem('chatbot_auth_token', '${accessToken}');
            document.cookie = 'chatbot_token=${accessToken}; path=/; domain=.chatbot24.ai; max-age=86400; SameSite=None; Secure';
            document.cookie = 'auth_token=${accessToken}; path=/; domain=.chatbot24.ai; max-age=86400; SameSite=None; Secure';
            
            // Also try to set session cookie
            document.cookie = 'session=${accessToken}; path=/; domain=.chatbot24.ai; max-age=86400; SameSite=None; Secure';
            
            // Wait a bit for cookies to be set, then redirect
            setTimeout(() => {
              window.location.href = 'https://dashboard.chatbot24.ai/settings/live-chat-integrations';
            }, 500);
          </script>
          <style>
            body {
              font-family: Arial, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
              background: #0A0F1C;
              color: white;
            }
            .container {
              text-align: center;
              padding: 40px;
              background: #1A2028;
              border-radius: 10px;
              border: 1px solid #2D3748;
            }
            .spinner {
              border: 4px solid #2D3748;
              border-top: 4px solid #60A5FB;
              border-radius: 50%;
              width: 40px;
              height: 40px;
              animation: spin 1s linear infinite;
              margin: 0 auto 20px;
            }
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="spinner"></div>
            <h2>Logging into Chatbot24.ai...</h2>
            <p>Please wait while we authenticate you.</p>
            <p>You will be redirected automatically.</p>
          </div>
        </body>
        </html>
      `;
      
      res.setHeader('Content-Type', 'text/html');
      res.send(autoLoginHtml);
      
    } else {
      throw new Error("No access token received");
    }

  } catch (error) {
    console.error("Auto-login redirect error:", error.response?.data || error.message);
    
    // Fallback: Redirect to login page with email pre-filled
    const email = req.query.email || '';
    const fallbackHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Redirecting to Login</title>
        <script>
          window.location.href = 'https://dashboard.chatbot24.ai/login?email=${encodeURIComponent(email)}';
        </script>
      </head>
      <body>
        <p>Redirecting to login page...</p>
      </body>
      </html>
    `;
    
    res.send(fallbackHtml);
  }
});

// **PROXY LOGIN ENDPOINT - This WILL work**
app.get("/api/proxy/chatbot/login-and-redirect", async (req, res) => {
  try {
    const { email, password } = req.query;
    
    if (!email || !password) {
      return res.status(400).send("Email and password required");
    }

    console.log(`Proxy login for: ${email}`);

    // Login to chatbot24.ai
    const loginResponse = await axios.post('https://api.chatbot24.ai/v1/auth/login', {
      device: {
        type: "browser",
        appVersion: "1.8.45",
        language: "en-GB",
        platform: "Win32",
        userAgent: "Mozilla/5.0",
        deviceID: `device_${Date.now()}`
      },
      password: password,
      timezone: "Asia/Dhaka",
      username: email
    });

    if (loginResponse.data.accessToken) {
      const token = loginResponse.data.accessToken;
      
      // **Create a PROXY PAGE that loads the dashboard with authentication**
      const proxyPage = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Chatbot Dashboard</title>
          <style>
            body, html {
              margin: 0;
              padding: 0;
              height: 100%;
              overflow: hidden;
              background: #0A0F1C;
            }
            .container {
              height: 100vh;
              display: flex;
              flex-direction: column;
            }
            .header {
              background: #1A2028;
              padding: 15px;
              border-bottom: 1px solid #2D3748;
              display: flex;
              justify-content: space-between;
              align-items: center;
            }
            .loading {
              display: flex;
              align-items: center;
              justify-content: center;
              height: 100%;
              color: white;
              flex-direction: column;
            }
            .spinner {
              border: 4px solid #2D3748;
              border-top: 4px solid #60A5FB;
              border-radius: 50%;
              width: 40px;
              height: 40px;
              animation: spin 1s linear infinite;
              margin-bottom: 20px;
            }
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div style="color: white; font-weight: bold;">Chatbot24.ai Dashboard</div>
              <button onclick="window.location.href='/dashboard'" style="background: #60A5FB; color: white; border: none; padding: 8px 16px; border-radius: 5px; cursor: pointer;">
                Back to App
              </button>
            </div>
            
            <!-- IFRAME THAT LOADS THE DASHBOARD WITH AUTHENTICATION -->
            <iframe 
              id="dashboardFrame"
              src="https://dashboard.chatbot24.ai/settings/live-chat-integrations"
              style="width: 100%; height: calc(100vh - 60px); border: none;"
              onload="hideLoading()"
            ></iframe>
            
            <div id="loading" class="loading">
              <div class="spinner"></div>
              <div>Loading chatbot dashboard...</div>
            </div>
          </div>
          
          <script>
            // Function to hide loading spinner
            function hideLoading() {
              document.getElementById('loading').style.display = 'none';
            }
            
            // Try to inject authentication into the iframe
            setTimeout(() => {
              try {
                const iframe = document.getElementById('dashboardFrame');
                const iframeWindow = iframe.contentWindow;
                
                // Try to set authentication in iframe's localStorage
                iframeWindow.localStorage.setItem('auth_token', '${token}');
                iframeWindow.localStorage.setItem('accessToken', '${token}');
                
                // Try to set cookies in iframe
                iframeWindow.document.cookie = 'auth_token=${token}; path=/; domain=.chatbot24.ai';
                iframeWindow.document.cookie = 'access_token=${token}; path=/; domain=.chatbot24.ai';
                
                console.log('Authentication injected into iframe');
                
                // Reload iframe with authentication
                setTimeout(() => {
                  iframe.src = iframe.src;
                }, 1000);
                
              } catch (error) {
                console.log('Cannot inject auth due to CORS:', error);
                // This is expected - we can't access cross-origin iframe
              }
            }, 2000);
            
            // If iframe shows login, redirect to our login helper
            setInterval(() => {
              try {
                const iframe = document.getElementById('dashboardFrame');
                const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                
                // Check if iframe is showing login page
                if (iframeDoc.body && (
                  iframeDoc.body.innerHTML.includes('login') || 
                  iframeDoc.body.innerHTML.includes('Login') ||
                  iframeDoc.body.innerHTML.includes('password') ||
                  iframeDoc.body.innerHTML.includes('sign in')
                )) {
                  console.log('Login page detected in iframe');
                  // Redirect iframe to a page that will auto-login
                  iframe.src = 'https://dashboard.chatbot24.ai/login?email=${encodeURIComponent('${email}')}';
                }
              } catch (error) {
                // CORS error - can't access iframe content
              }
            }, 3000);
          </script>
        </body>
        </html>
      `;
      
      res.setHeader('Content-Type', 'text/html');
      res.send(proxyPage);
      
    } else {
      throw new Error("Login failed");
    }

  } catch (error) {
    console.error("Proxy login error:", error.message);
    
    // Simple fallback page
    const email = req.query.email || '';
    const fallbackPage = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Chatbot Dashboard</title>
        <style>
          body { font-family: Arial; padding: 40px; text-align: center; background: #0A0F1C; color: white; }
          .container { max-width: 500px; margin: 0 auto; }
          .btn { background: #60A5FB; color: white; padding: 12px 24px; border: none; border-radius: 5px; cursor: pointer; margin: 10px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>Open Chatbot Dashboard</h2>
          <p>Click below to open the chatbot24.ai dashboard:</p>
          <button class="btn" onclick="window.open('https://dashboard.chatbot24.ai/login?email=${encodeURIComponent(email)}', '_blank')">
            Open Login Page
          </button>
          <br>
          <button class="btn" onclick="window.open('https://dashboard.chatbot24.ai/settings/live-chat-integrations', '_blank')">
            Open Dashboard Directly
          </button>
          <br>
          <button class="btn" onclick="window.location.href='/dashboard'" style="background: #4A5568;">
            Back to App
          </button>
        </div>
      </body>
      </html>
    `;
    
    res.send(fallbackPage);
  }
});

// In server.js - Add this endpoint
app.get("/api/proxy/chatbot/direct-login", async (req, res) => {
  try {
    const { email, password } = req.query;
    
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    console.log(`Direct login attempt for: ${email}`);

    // Call chatbot24.ai login API
    const loginResponse = await axios.post('https://api.chatbot24.ai/v1/auth/login', {
      device: {
        type: "browser",
        appVersion: "1.8.45",
        language: "en-GB",
        platform: "Win32",
        userAgent: "Mozilla/5.0",
        deviceID: `device_${Date.now()}`
      },
      password: password,
      timezone: "Asia/Dhaka",
      username: email
    });

    if (loginResponse.data.accessToken) {
      // Return the access token
      res.json({
        success: true,
        accessToken: loginResponse.data.accessToken,
        email: email
      });
    } else {
      throw new Error("No access token received");
    }

  } catch (error) {
    console.error("Direct login error:", error.message);
    res.status(500).json({
      success: false,
      error: "Login failed",
      message: error.message
    });
  }
});

// **5. Debug Endpoint**
app.get('/api/proxy/chatbot/debug', (req, res) => {
  res.json({
    totalSessions: Object.keys(chatbotSessions).length,
    sessions: Object.keys(chatbotSessions).map(id => ({
      id,
      email: chatbotSessions[id].email,
      createdAt: new Date(chatbotSessions[id].createdAt).toLocaleString()
    }))
  })
})

// Cleanup old sessions every hour
setInterval(() => {
  const now = Date.now()
  let cleaned = 0

  for (const [sessionId, session] of Object.entries(chatbotSessions)) {
    if (now - session.createdAt > 24 * 60 * 60 * 1000) {
      delete chatbotSessions[sessionId]
      cleaned++
    }
  }

  if (cleaned > 0) {
    console.log(`Cleaned up ${cleaned} expired sessions`)
  }
}, 60 * 60 * 1000)

// Your existing routes
app.use('/api/users', userRoutes)
app.use('/api/auth', authRoutes)

app.get('/', (req, res) => {
  res.send('API is running with chatbot proxy support...')
})

app.use(notFound)
app.use(errorHandler)

const PORT = process.env.PORT || 5000
app.listen(PORT, () => console.log(`Server running on port ${PORT}`))
