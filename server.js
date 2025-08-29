require('dotenv').config();

// Import configuration and error handling
const ConfigValidator = require('./utils/configValidator');
const errorHandler = require('./utils/errorHandler');
const logger = require('./utils/logger');

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const wahaService = require('./services/wahaService');
const openrouterService = require('./services/openrouterService');
const memoryService = require('./services/memoryService');
const messageProcessor = require('./services/messageProcessor');

// Simple Server-Sent Events (SSE) hub for realtime UI updates
const sseClients = new Set();
function sseBroadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (_) {
      // On write failure, drop client
      try { client.end(); } catch (_) {}
      sseClients.delete(client);
    }
  }
}

// Validate configuration at startup
let config;
try {
  config = ConfigValidator.getValidatedConfig();
  ConfigValidator.printConfigSummary(config);
} catch (error) {
  logger.error('Config', 'Failed to start server due to configuration errors', error);
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
// Apply rate limiter to general routes only (exclude webhooks and SSE)
app.use((req, res, next) => {
  const p = req.path || '';
  if (p === '/events' || p === '/waha-events' || p === '/webhook' || p === '/health') return next();
  return limiter(req, res, next);
});

// Logging middleware
app.use((req, res, next) => {
  if (logger.isLevelEnabled('DEBUG')) {
    logger.debug('HTTP', `${req.method} ${req.path}`);
  }
  next();
});

// GET /events - Server-Sent Events stream for realtime status updates
app.get('/events', (req, res) => {
  // Improve SSE reliability
  req.socket.setTimeout(0);
  req.socket.setNoDelay(true);
  req.socket.setKeepAlive(true);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (config.security.corsOrigin === '*') {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.flushHeaders && res.flushHeaders();

  // Send initial comment to open stream
  try { res.write(': connected\n\n'); } catch (_) {}

  // Add client
  sseClients.add(res);

  // Heartbeat to keep proxies from closing idle connection
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) {}
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
    try { res.end(); } catch (_) {}
  });
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
    logger.error('QR', 'Error getting QR code', error);
    
    // Handle the case where WhatsApp is already connected
    if (error.message && error.message.includes('already connected')) {
      return res.json({ 
        success: false, 
        message: error.message,
        alreadyConnected: true 
      });
    }
    // Handle logout lock state: auto-unlock and retry once for smoother UX
    if (error.message && error.message.toLowerCase().includes('locked')) {
      try {
        logger.info('QR', 'QR requested while session locked. Auto-unlocking and retrying...');
        if (typeof wahaService.unlockLogout === 'function') wahaService.unlockLogout();
        const qrCode = await wahaService.getQRCode();
        return res.json({ success: true, qrCode, unlocked: true });
      } catch (retryErr) {
        logger.warning('QR', 'Retry after unlock failed', retryErr);
        return res.status(409).json({ 
          success: false,
          message: 'Session was locked and retry failed. Please try again.',
          locked: true
        });
      }
    }
    
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /config - Configure OpenRouter API key and settings
app.post('/config', async (req, res) => {
  try {
    const { openrouterApiKey, aiModel, systemPrompt } = req.body || {};
    const existing = await memoryService.getConfig();

    // Determine new API key value: keep existing if not provided or masked
    let newApiKey = existing?.openrouterApiKey || '';
    if (typeof openrouterApiKey === 'string' && openrouterApiKey.trim()) {
      if (openrouterApiKey.trim() !== '***configured***') {
        newApiKey = openrouterApiKey.trim();
      }
    }

    // API key is optional: if empty and no existing key, allow saving other settings
    // When left empty, existing key (if any) is preserved via newApiKey default above

    const newConfig = {
      openrouterApiKey: newApiKey,
      aiModel: (aiModel || existing?.aiModel || 'openai/gpt-4o-mini'),
      systemPrompt: (systemPrompt || existing?.systemPrompt || 'You are a helpful WhatsApp assistant.'),
      wahaBaseUrl: existing?.wahaBaseUrl || process.env.WAHA_BASE_URL || 'http://localhost:3000',
      // Default webhook URL used for WAHA events points to host.docker.internal
      webhookUrl: existing?.webhookUrl || process.env.WEBHOOK_URL || 'http://host.docker.internal:3001/waha-events',
      lastUpdated: new Date().toISOString()
    };

    await memoryService.saveConfig(newConfig);
    res.json({ success: true, message: 'Configuration saved successfully' });
  } catch (error) {
    logger.error('Config', 'Error saving configuration', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Log level endpoints
app.get('/log-level', (req, res) => {
  try {
    res.json({ success: true, level: logger.getLevel() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/log-level', async (req, res) => {
  try {
    const { level } = req.body || {};
    const allowed = ['debug', 'info', 'warning', 'warn', 'error'];
    if (!level || !allowed.includes(String(level).toLowerCase())) {
      return res.status(400).json({ success: false, error: `Invalid level. Allowed: ${allowed.join(', ')}` });
    }

    // Normalize 'warn' to 'warning'
    const normalized = String(level).toLowerCase() === 'warn' ? 'warning' : String(level).toLowerCase();
    logger.setLevel(normalized);

    // Persist to config.json
    try {
      const existing = await memoryService.getConfig();
      const updated = { ...(existing || {}), logLevel: normalized, lastUpdated: new Date().toISOString() };
      await memoryService.saveConfig(updated);
    } catch (_) { /* non-fatal */ }

    res.json({ success: true, level: logger.getLevel() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Legacy /webhook endpoint removed - all webhook traffic now goes through /waha-events

// GET /status - Get connection and system status
app.get('/status', async (req, res) => {
  try {
    const status = await memoryService.getStatus();
    const wahaConnected = await wahaService.checkConnection();
    const config = await memoryService.getConfig();
    const openrouterConfigured = !!(config && typeof config.openrouterApiKey === 'string' && config.openrouterApiKey.trim().startsWith('sk-'));
    
    // Get session status
    let sessionStatus = 'UNKNOWN';
    let isAuthenticated = false;
    try {
      const rawSession = await wahaService.getSessionStatus();
      // Normalize to a simple string for UI (avoid [object Object])
      sessionStatus = (typeof rawSession === 'string')
        ? rawSession
        : (rawSession && typeof rawSession.status === 'string' ? rawSession.status : 'UNKNOWN');
      // Determine authentication
      if (typeof wahaService.isAuthenticated === 'function') {
        isAuthenticated = await wahaService.isAuthenticated();
      } else {
        isAuthenticated = (sessionStatus === 'WORKING' || sessionStatus === 'AUTHENTICATED');
      }
    } catch (error) {
      logger.warning('Status', 'Could not get session status', error);
    }

    // Skip proactive webhook ensures from /status; background monitor handles it
    
    const uptime = process.uptime();
    const uptimeString = `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`;
    
    res.json({
      wahaConnected,
      openrouterConfigured,
      sessionStatus,
      isAuthenticated,
      systemReady: Boolean(wahaConnected && isAuthenticated),
      messagesProcessed: status.messagesProcessed || 0,
      uptime: uptimeString,
      uptimeSeconds: Math.floor(uptime),
      lastMessageAt: status.lastMessageAt,
      errors: status.errors || []
    });
  } catch (error) {
    logger.error('Status', 'Error getting status', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /conversations - View conversation history
app.get('/conversations', async (req, res) => {
  try {
    const conversations = await memoryService.getAllConversations();
    res.json({ success: true, conversations });
  } catch (error) {
    logger.error('Conversations', 'Error getting conversations', error);
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
    logger.error('Conversations', 'Error clearing conversations', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/sessions/:session - Delete a WhatsApp session on WAHA (forces re-auth QR)
app.delete('/api/sessions/:session', async (req, res) => {
  try {
    const { session } = req.params;
    logger.info('Session', `Attempting to delete session on WAHA: ${session}`);

    // Delete session from WAHA so it cannot auto-restore and requires QR
    const result = await wahaService.deleteSession(session);

    logger.info('Session', `Session ${session} delete result`, result);
    res.json({ 
      success: true, 
      message: `Session ${session} deleted on WAHA`,
      result 
    });
  } catch (error) {
    logger.error('Session', `Error deleting session ${req.params.session}`, error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      message: `Failed to delete session ${req.params.session}` 
    });
  }
});

// POST /api/sessions/:session/logout - Logout from a WhatsApp session on WAHA
app.post('/api/sessions/:session/logout', async (req, res) => {
  try {
    const { session } = req.params;
    logger.info('Session', `Attempting to logout session on WAHA: ${session}`);

    const result = await wahaService.logoutSession(session);

    logger.info('Session', `Session ${session} logout result`, result);
    res.json({
      success: true,
      message: `Session ${session} logged out on WAHA`,
      result
    });
  } catch (error) {
    logger.error('Session', `Error logging out session ${req.params.session}`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: `Failed to logout session ${req.params.session}`
    });
  }
});

// POST /test-openrouter - Test OpenRouter API connection
app.post('/test-openrouter', async (req, res) => {
  try {
    const result = await openrouterService.testConnection();
    res.json({ success: true, result });
  } catch (error) {
    logger.error('OpenRouter', 'Error testing OpenRouter', error);
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
    logger.error('OpenRouter', 'Error testing OpenRouter API key', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to test API key: ' + error.message 
    });
  }
});

// GET /openrouter/models - Return list of model IDs from OpenRouter
app.get('/openrouter/models', async (req, res) => {
  try {
    const apiKey = (req.query.apiKey || '').toString();
    const models = await openrouterService.getAvailableModels(apiKey);
    // Return only model IDs (e.g., "openai/gpt-4o-mini")
    const ids = Array.isArray(models)
      ? models
          .map(m => (typeof m === 'string' ? m : (m?.id || '')))
          .filter(Boolean)
      : [];
    res.json({ success: true, models: ids });
  } catch (error) {
    logger.error('OpenRouter', 'Error fetching OpenRouter models', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Primary webhook endpoint for WAHA events
app.post(['/waha-events', '/webhook'], async (req, res) => {
  const timestamp = new Date().toISOString();
  logger.info('Webhook', 'Webhook received at /waha-events');
  
  // Immediately acknowledge the webhook
  res.status(200).json({ status: 'received' });
  
  // Log incoming webhook data
  logger.debug('Webhook', 'Webhook details', {
    event: req.body?.event,
    session: req.body?.session,
    payloadKeys: Object.keys(req.body?.payload || {}),
    contentType: req.headers['content-type'],
    userAgent: req.headers['user-agent']
  });
  
  // Process the event asynchronously
  try {
    const event = req.body;
    logger.info('Webhook', `Processing event: ${event.event}`);
    
    // Broadcast event to SSE clients
    try {
      sseBroadcast({
        type: event.event || 'unknown',
        session: event.session || 'default',
        payload: event.payload || {},
        timestamp
      });
    } catch (_) {}
    
    // Handle different event types
    if (event.event === 'ready' || event.event === 'auth' || event.event === 'state.change') {
      logger.info('Webhook', 'Setting up webhook for session state change...');
      await wahaService.setupWebhookAfterAuth(event.session || 'default');
    }
    
    // Process message events
    if (event.event === 'message' || event.event === 'message.any') {
      logger.info('Webhook', 'Processing message event...');
      try {
        const p = event.payload || {};
        const sender = p?.from || p?.chatId || p?.chat?.id || 'unknown';
        const mtype = p?.type || p?.message?.type || 'text';
        const preview = (p?.body || p?.text || '').toString();
        logger.info('Message', `Incoming ${mtype} from ${sender}: ${preview.substring(0, 80)}`);
      } catch (_) {}
      const result = await messageProcessor.processMessage(event.payload, event.session || 'default');
      logger.info('Message', `Message processing result: ${result}`);
    } else if (event.event === 'session.status') {
      if (event.payload?.status === 'WORKING') {
        await wahaService.setupWebhookAfterAuth(event.session || 'default');
      }
    } else {
      const isDebug = logger.isLevelEnabled('DEBUG');
      if (isDebug) logger.debug('Webhook', `Unknown WAHA event type: ${event.event}`);
    }
    
    logger.info('Webhook', 'Webhook event processing completed');
  } catch (error) {
    logger.error('Webhook', 'Error processing webhook event', error);
    logger.error('Webhook', 'Error context', {
      event: req.body?.event,
      session: req.body?.session,
      error: error.message,
      stack: error.stack
    });
  }
});

// Webhook endpoint for WAHA events (duplicate disabled)
app.post('/waha-events-dup-disabled', async (req, res) => {
  const timestamp = new Date().toISOString();
  logger.debug('Webhook', 'WAHA Webhook Event Received');
  logger.debug('Webhook', 'Headers', req.headers);
  logger.debug('Webhook', 'Body', req.body);
  logger.debug('Webhook', 'Query', req.query);
  
  try {
    const event = req.body;
    
    // Broadcast all WAHA events to UI (minimal, safe payload)
    try {
      sseBroadcast({
        type: event.event || 'unknown',
        session: event.session || 'default',
        payload: event.payload || {},
        timestamp
      });
    } catch (_) {}

    // Ensure webhook is configured on any clear auth/ready signals (idempotent)
    try {
      if (event.event === 'ready' || event.event === 'auth' || (event.event === 'state.change' && (event.payload?.state === 'CONNECTED' || event.payload?.state === 'OPEN'))) {
        await wahaService.setupWebhookAfterAuth(event.session || 'default');
      }
    } catch (_) {}

    // Process the event based on its type
    if (event.event === 'message') {
      logger.info('Webhook', 'Processing message event...');
      await messageProcessor.processMessage(event.payload);
    } else if (event.event === 'session.status') {
      logger.info('Webhook', `Session status changed: ${event.payload.status}`);
      
      // If session becomes WORKING, set up webhook
      if (event.payload.status === 'WORKING') {
        await wahaService.setupWebhookAfterAuth(event.session || 'default');
      }
    } else {
      logger.debug('Webhook', `Unknown event type: ${event.event}`);
    }
    
    res.status(200).json({ success: true, timestamp });
  } catch (error) {
    logger.error('Webhook', 'Error processing WAHA webhook', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Configure webhook endpoint
app.post('/configure-webhook', async (req, res) => {
  try {
    const result = await wahaService.configureWahaEventsWebhook();
    res.json(result);
  } catch (error) {
    logger.error('Webhook', 'Error configuring webhook', error);
    res.status(500).json({ error: error.message });
  }
});

// Debug webhook endpoint
app.get('/debug-webhook', async (req, res) => {
  try {
    logger.debug('Debug', 'Debug webhook endpoint called');
    
    const sessionName = req.query.session || 'default';
    const wahaUrl = process.env.WAHA_URL || 'http://localhost:3000';
    
    // Check session status
    const sessionStatus = await wahaService.getSessionStatus(sessionName);
    logger.debug('Debug', `Session '${sessionName}' status`, sessionStatus);
    
    // Check if session is authenticated
    const isAuth = await wahaService.isAuthenticated(sessionName);
    logger.debug('Debug', `Session '${sessionName}' authenticated: ${isAuth}`);
    
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
        logger.warning('Debug', `Could not fetch webhook config: ${response.status}`);
      }
    } catch (error) {
      logger.warning('Debug', 'Error fetching webhook config', error);
    }
    
    const candidateUrls = (typeof wahaService.getCandidateWebhookUrls === 'function') ? wahaService.getCandidateWebhookUrls() : [];
    const debugInfo = {
      timestamp: new Date().toISOString(),
      session: sessionName,
      sessionStatus,
      isAuthenticated: isAuth,
      webhookConfig,
      expectedWebhookUrl: (typeof wahaService.getEventsWebhookUrl === 'function' ? wahaService.getEventsWebhookUrl() : 'http://host.docker.internal:3001/waha-events'),
      expectedWebhookUrls: candidateUrls,
      wahaUrl,
      serverPort: process.env.PORT || 3001
    };
    
    logger.debug('Debug', 'Debug info', debugInfo);
    
    res.json(debugInfo);
  } catch (error) {
    logger.error('Debug', 'Error in debug webhook', error);
    res.status(500).json({ 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Force webhook reconfiguration endpoint
app.post('/debug-webhook', async (req, res) => {
  try {
    logger.info('Debug', 'Forcing webhook reconfiguration...');
    
    // Force reconfigure the webhook for default session
    await wahaService.configureWahaEventsWebhook();
    
    logger.info('Debug', 'Webhook reconfiguration completed');
    res.json({ 
      success: true, 
      message: 'Webhook reconfigured successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Debug', 'Error reconfiguring webhook', error);
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
    logger.error('Config', 'Error getting configuration', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test session creation endpoint
app.post('/test-session-creation', async (req, res) => {
  try {
    logger.info('Test', 'Testing session creation with proper webhook config...');
    
    const sessionName = req.body.sessionName || 'default';
    
    // Create a new WAHA service instance for testing
    const testWahaService = require('./services/wahaService');
    testWahaService.sessionName = sessionName;
    
    // Attempt to create/update session with webhook config
    const result = await testWahaService.startOrUpdateSession();
    
    logger.info('Test', 'Test session creation completed successfully');
    res.json({ 
      success: true, 
      message: 'Session created/updated successfully with webhook config',
      result,
      sessionName,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Test', 'Test session creation failed', error);
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
    logger.info('Server', 'Initializing memory service...');
    await memoryService.initialize();
    logger.info('Server', 'Memory service initialized successfully');

    // After memory init, load persisted log level if present and no env override
    try {
      if (!process.env.LOG_LEVEL) {
        const saved = await memoryService.getConfig();
        const savedLevel = (saved && saved.logLevel) ? String(saved.logLevel).toLowerCase() : null;
        if (savedLevel) {
          logger.setLevel(savedLevel);
        } else if (config && config.logLevel) {
          logger.setLevel(config.logLevel);
        }
      } else if (config && config.logLevel) {
        logger.setLevel(config.logLevel);
      }
    } catch (_) { /* ignore */ }
  } catch (error) {
    logger.error('Server', 'Failed to initialize memory service', error);
    await errorHandler.logError('Initialization Error', error);
    process.exit(1);
  }
}

// Start server
initializeServer().then(() => {
  app.listen(PORT, async () => {
    logger.info('Server', `WhatsApp AI Bot server running on port ${PORT}`);
    logger.info('Server', `Dashboard: http://localhost:${PORT}`);
    // Clarify WAHA events webhook URL for Docker-based WAHA deployments
    logger.info('Server', `WAHA Events Webhook (for WAHA): http://host.docker.internal:3001/waha-events`);
    logger.info('Server', `Events Endpoint Path: ${config.webhook.path}`);
    logger.info('Server', `Health Check: http://localhost:${PORT}/health`);
    
    try {
      // Update status after server starts
      await memoryService.updateStatus({
        startTime: new Date().toISOString(),
        lastHealthCheck: new Date().toISOString(),
        wahaConnected: false,
        openrouterConfigured: config.openrouter.configured
      });
      
      logger.info('Server', 'Server initialization completed successfully');

      // Ensure the default WAHA session exists at startup (create if missing) with webhook
      try {
        const ensureRes = await wahaService.ensureDefaultSessionExistsWithWebhook();
        const msg = ensureRes?.created
          ? 'Default WAHA session created'
          : `Default WAHA session present (status: ${ensureRes?.status || 'unknown'})`;
        logger.info('Server', msg);
      } catch (e) {
        logger.warning('Server', 'Default session ensure failed (non-fatal)', e);
      }

      // Start a background monitor to ensure WAHA events webhook gets configured
      // as soon as the session becomes authenticated. No immediate ensure here.
      try { wahaService.startWebhookAuthMonitor(config.waha.sessionName); } catch (_) {}
    } catch (error) {
      logger.error('Server', 'Failed to update status', error);
      await errorHandler.logError('Status Update Error', error);
    }
  });
}).catch((error) => {
  logger.error('Server', 'Failed to start server', error);
  process.exit(1);
});

module.exports = app;
