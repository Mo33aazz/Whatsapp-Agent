require('dotenv').config();

// Import configuration and error handling
const ConfigValidator = require('./utils/configValidator');
const errorHandler = require('./utils/errorHandler');

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const wahaService = require('./services/wahaService');
const openrouterService = require('./services/openrouterService');
const memoryService = require('./services/memoryService');
const messageProcessor = require('./services/messageProcessor');

// Validate configuration at startup
let config;
try {
  config = ConfigValidator.getValidatedConfig();
  ConfigValidator.printConfigSummary(config);
} catch (error) {
  console.error('Failed to start server due to configuration errors:', error.message);
  process.exit(1);
}

const app = express();
const PORT = config.port;

// Middleware
if (config.security.helmetEnabled) {
  app.use(helmet());
}

app.use(cors({
  origin: config.security.corsOrigin === '*' ? true : config.security.corsOrigin
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting
const limiter = rateLimit({
  windowMs: config.security.rateLimit.windowMs,
  max: config.security.rateLimit.max,
  message: {
    success: false,
    error: 'Too many requests, please try again later.'
  }
});
app.use(limiter);

// Logging middleware
app.use((req, res, next) => {
  if (config.logLevel === 'debug' || config.nodeEnv === 'development') {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  }
  next();
});

// Routes

// GET / - Home dashboard with QR code and configuration
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// GET /qr - Display QR code for WhatsApp authentication
app.get('/qr', async (req, res) => {
  try {
    const qrCode = await wahaService.getQRCode();
    res.json({ success: true, qrCode });
  } catch (error) {
    console.error('Error getting QR code:', error);
    
    // Handle the case where WhatsApp is already connected
    if (error.message && error.message.includes('already connected')) {
      return res.json({ 
        success: false, 
        message: error.message,
        alreadyConnected: true 
      });
    }
    
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /config - Configure OpenRouter API key and settings
app.post('/config', async (req, res) => {
  try {
    const { openrouterApiKey, aiModel, systemPrompt } = req.body;
    
    if (!openrouterApiKey) {
      return res.status(400).json({ success: false, message: 'OpenRouter API key is required' });
    }

    const config = {
      openrouterApiKey,
      aiModel: aiModel || 'openai/gpt-4o-mini',
      systemPrompt: systemPrompt || 'You are a helpful WhatsApp assistant.',
      wahaBaseUrl: process.env.WAHA_BASE_URL || 'http://localhost:3000',
      webhookUrl: process.env.WEBHOOK_URL || 'http://localhost:5000/webhook'
    };

    await memoryService.saveConfig(config);
    res.json({ success: true, message: 'Configuration saved successfully' });
  } catch (error) {
    console.error('Error saving configuration:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /webhook - Receive incoming WhatsApp messages from WAHA
app.post('/webhook', async (req, res) => {
  try {
    const { event, session, payload } = req.body;
    
    console.log('Webhook received:', { event, session, payload });
    
    let processed = false;
    
    // Handle session status changes
    if (event === 'session.status') {
      console.log(`Session ${session} status changed to:`, payload);
      
      // If session is now authenticated (WORKING), setup webhooks
      if (payload && payload.status === 'WORKING') {
        try {
          await wahaService.setupWebhookAfterAuth();
          console.log('Webhooks configured after successful authentication');
        } catch (error) {
          console.error('Failed to setup webhooks after auth:', error);
        }
      }
      
      processed = await messageProcessor.processSystemEvent(payload, session);
    }
    // Handle incoming messages
    else if (event === 'message' && payload && payload.body) {
      // Validate payload
      if (!messageProcessor.validatePayload(payload)) {
        return res.status(400).json({ status: 'error', error: 'Invalid payload' });
      }
      
      processed = await messageProcessor.processMessage(payload, session);
    }
    // Handle authentication events
    else if (event === 'auth' || event === 'qr' || event === 'ready') {
      console.log(`Authentication event ${event} for session ${session}:`, payload);
      processed = true;
    }
    else {
      console.log(`Unhandled webhook event: ${event}`);
    }
    
    res.json({ status: 'success', processed, event });
  } catch (error) {
    console.error('Error processing webhook:', error);
    await memoryService.addError(`Webhook error: ${error.message}`);
    res.status(500).json({ status: 'error', error: error.message });
  }
});

// GET /status - Get connection and system status
app.get('/status', async (req, res) => {
  try {
    const status = await memoryService.getStatus();
    const wahaConnected = await wahaService.checkConnection();
    const config = await memoryService.getConfig();
    const openrouterConfigured = !!(config && config.openrouterApiKey);
    
    // Get session status
    let sessionStatus = 'UNKNOWN';
    let isAuthenticated = false;
    try {
      sessionStatus = await wahaService.getSessionStatus();
      // Check if isAuthenticated method exists and is a function
      if (typeof wahaService.isAuthenticated === 'function') {
        isAuthenticated = await wahaService.isAuthenticated();
      } else {
        // Fallback: check if session status is WORKING
        isAuthenticated = sessionStatus && sessionStatus.status === 'WORKING';
      }
    } catch (error) {
      console.log('Could not get session status:', error.message);
    }
    
    const uptime = process.uptime();
    const uptimeString = `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`;
    
    res.json({
      wahaConnected,
      openrouterConfigured,
      sessionStatus,
      isAuthenticated,
      messagesProcessed: status.messagesProcessed || 0,
      uptime: uptimeString,
      lastMessageAt: status.lastMessageAt,
      errors: status.errors || []
    });
  } catch (error) {
    console.error('Error getting status:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /conversations - View conversation history
app.get('/conversations', async (req, res) => {
  try {
    const conversations = await memoryService.getAllConversations();
    res.json({ success: true, conversations });
  } catch (error) {
    console.error('Error getting conversations:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /conversations - Clear all conversation history
app.delete('/conversations', async (req, res) => {
  try {
    await memoryService.writeJsonFile(
      path.join(__dirname, 'data', 'conversations.json'),
      {}
    );
    memoryService.clearCache();
    res.json({ success: true, message: 'All conversations cleared' });
  } catch (error) {
    console.error('Error clearing conversations:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /test-openrouter - Test OpenRouter API connection
app.post('/test-openrouter', async (req, res) => {
  try {
    const result = await openrouterService.testConnection();
    res.json({ success: true, result });
  } catch (error) {
    console.error('Error testing OpenRouter:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /config/test-openrouter - Test OpenRouter API key from frontend
app.post('/config/test-openrouter', async (req, res) => {
  try {
    const { openrouterApiKey } = req.body;
    
    if (!openrouterApiKey) {
      return res.status(400).json({ 
        success: false, 
        message: 'OpenRouter API key is required' 
      });
    }

    // Validate API key format
    if (!openrouterApiKey.startsWith('sk-or-v1-') && !openrouterApiKey.startsWith('sk-')) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid API key format. Must start with "sk-or-v1-" or "sk-"' 
      });
    }

    // Test the API key by making a simple request to OpenRouter
    const testResult = await openrouterService.testApiKey(openrouterApiKey);
    
    if (testResult.success) {
      res.json({ 
        success: true, 
        message: 'API key is valid and working',
        details: testResult.details 
      });
    } else {
      res.status(400).json({ 
        success: false, 
        message: testResult.message || 'API key test failed' 
      });
    }
  } catch (error) {
    console.error('Error testing OpenRouter API key:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to test API key: ' + error.message 
    });
  }
});

// Webhook endpoint for WAHA events
app.post('/waha-events', async (req, res) => {
  const timestamp = new Date().toISOString();
  console.log(`\n🔔 [${timestamp}] WAHA Webhook Event Received:`);
  console.log('📨 Headers:', JSON.stringify(req.headers, null, 2));
  console.log('📨 Body:', JSON.stringify(req.body, null, 2));
  console.log('📨 Query:', JSON.stringify(req.query, null, 2));
  
  try {
    const event = req.body;
    
    // Process the event based on its type
    if (event.event === 'message') {
      console.log('💬 Processing message event...');
      await messageProcessor.processMessage(event.payload);
    } else if (event.event === 'session.status') {
      console.log(`📱 Session status changed: ${event.payload.status}`);
      
      // If session becomes WORKING, set up webhook
      if (event.payload.status === 'WORKING') {
        await wahaService.setupWebhookAfterAuth(event.session || 'default');
      }
    } else {
      console.log(`🔍 Unknown event type: ${event.event}`);
    }
    
    res.status(200).json({ success: true, timestamp });
  } catch (error) {
    console.error('❌ Error processing WAHA webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Configure webhook endpoint
app.post('/configure-webhook', async (req, res) => {
  try {
    const result = await wahaService.configureWahaEventsWebhook();
    res.json(result);
  } catch (error) {
    console.error('Error configuring webhook:', error);
    res.status(500).json({ error: error.message });
  }
});

// Debug webhook endpoint
app.get('/debug-webhook', async (req, res) => {
  try {
    console.log('🔍 Debug webhook endpoint called');
    
    const sessionName = req.query.session || 'default';
    const wahaUrl = process.env.WAHA_URL || 'http://localhost:3000';
    
    // Check session status
    const sessionStatus = await wahaService.getSessionStatus(sessionName);
    console.log(`📱 Session '${sessionName}' status:`, sessionStatus);
    
    // Check if session is authenticated
    const isAuth = await wahaService.isAuthenticated(sessionName);
    console.log(`🔐 Session '${sessionName}' authenticated:`, isAuth);
    
    // Get webhook configuration from WAHA
    let webhookConfig = null;
    try {
      const response = await fetch(`${wahaUrl}/api/sessions/${sessionName}/webhooks`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        webhookConfig = await response.json();
      } else {
        console.log(`⚠️ Could not fetch webhook config: ${response.status}`);
      }
    } catch (error) {
      console.log('⚠️ Error fetching webhook config:', error.message);
    }
    
    const debugInfo = {
      timestamp: new Date().toISOString(),
      session: sessionName,
      sessionStatus,
      isAuthenticated: isAuth,
      webhookConfig,
      expectedWebhookUrl: `http://localhost:${process.env.PORT || 3001}/waha-events`,
      wahaUrl,
      serverPort: process.env.PORT || 3001
    };
    
    console.log('🔍 Debug info:', JSON.stringify(debugInfo, null, 2));
    
    res.json(debugInfo);
  } catch (error) {
    console.error('❌ Error in debug webhook:', error);
    res.status(500).json({ 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Force webhook reconfiguration endpoint
app.post('/debug-webhook', async (req, res) => {
  try {
    console.log('🔧 Forcing webhook reconfiguration...');
    
    // Force reconfigure the webhook for default session
    await wahaService.configureWahaEventsWebhook();
    
    console.log('✅ Webhook reconfiguration completed');
    res.json({ 
      success: true, 
      message: 'Webhook reconfigured successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error reconfiguring webhook:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /config - Get current configuration
app.get('/config', async (req, res) => {
  try {
    const config = await memoryService.getConfig();
    // Don't expose the full API key, just show if it's configured
    const safeConfig = {
      ...config,
      openrouterApiKey: config.openrouterApiKey ? '***configured***' : ''
    };
    res.json({ success: true, config: safeConfig });
  } catch (error) {
    console.error('Error getting configuration:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test session creation endpoint
app.post('/test-session-creation', async (req, res) => {
  try {
    console.log('🧪 Testing session creation with proper webhook config...');
    
    const sessionName = req.body.sessionName || 'default';
    
    // Create a new WAHA service instance for testing
    const testWahaService = require('./services/wahaService');
    testWahaService.sessionName = sessionName;
    
    // Attempt to create/update session with webhook config
    const result = await testWahaService.startOrUpdateSession();
    
    console.log('✅ Test session creation completed successfully');
    res.json({ 
      success: true, 
      message: 'Session created/updated successfully with webhook config',
      result,
      sessionName,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Test session creation failed:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      sessionName: req.body.sessionName || 'default',
      timestamp: new Date().toISOString()
    });
  }
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const health = await errorHandler.checkSystemHealth();
    res.status(health.status === 'healthy' ? 200 : 503).json(health);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Error handling middleware (must be last)
app.use(errorHandler.expressErrorHandler.bind(errorHandler));

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// Initialize memory service before starting server
async function initializeServer() {
  try {
    console.log('Initializing memory service...');
    await memoryService.initialize();
    console.log('Memory service initialized successfully');
  } catch (error) {
    console.error('Failed to initialize memory service:', error);
    await errorHandler.logError('Initialization Error', error);
    process.exit(1);
  }
}

// Start server
initializeServer().then(() => {
  app.listen(PORT, async () => {
    console.log(`WhatsApp AI Bot server running on port ${PORT}`);
    console.log(`Dashboard: http://localhost:${PORT}`);
    console.log(`Webhook: http://localhost:${PORT}${config.webhook.path}`);
    console.log(`Health Check: http://localhost:${PORT}/health`);
    
    try {
      // Update status after server starts
      await memoryService.updateStatus({
        startTime: new Date().toISOString(),
        lastHealthCheck: new Date().toISOString(),
        wahaConnected: false,
        openrouterConfigured: config.openrouter.configured
      });
      
      console.log('Server initialization completed successfully');
    } catch (error) {
      console.error('Failed to update status:', error);
      await errorHandler.logError('Status Update Error', error);
    }
  });
}).catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

module.exports = app;