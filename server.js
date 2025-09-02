require('dotenv').config();

// Core utilities and services
const path = require('path');
const express = require('express');
const ConfigValidator = require('./utils/configValidator');
const errorHandler = require('./utils/errorHandler');
const logger = require('./utils/logger');
const memoryService = require('./services/memoryService');
const wahaService = require('./services/wahaService');

// WAHA Initializer services
const WAHAInitializer = require('./services/wahaInitializer');
const WAHAErrorHandler = require('./services/wahaErrorHandler');

// App composition
const { applyMiddlewares } = require('./app/middlewares');
const { registerRoutes } = require('./routes');

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

// Persisted uptime accumulator (in seconds) carried across restarts
let UPTIME_BASE_SECONDS = 0; // kept for backward compatibility; not used after refactor

function formatUptime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

async function persistUptime() {
  try {
    const seconds = Math.floor((typeof uptimeBaseSecondsRef?.value === 'number' ? uptimeBaseSecondsRef.value : UPTIME_BASE_SECONDS) + process.uptime());
    await memoryService.updateStatus({
      uptimeSeconds: seconds,
      uptime: formatUptime(seconds)
    });
  } catch (_) {
    // Non-fatal
  }
}

// Apply middlewares (helmet, cors, parsers, static, rate limit, logging)
applyMiddlewares(app, config);

// Register routes (including SSE) in a dedicated router layer
// Helpers passed to routes for status/uptime formatting
const uptimeBaseSecondsRef = { value: 0 };
registerRoutes(app, config, { formatUptime, uptimeBaseSecondsRef });

// Routes are registered via routes/index.js above

// (All route handlers have been moved to routes/* files)

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

      // Load persisted uptime base and start periodic persistence
      try {
        const st = await memoryService.getStatus();
        const prev = parseInt(st?.uptimeSeconds || 0, 10);
        uptimeBaseSecondsRef.value = isNaN(prev) ? 0 : Math.max(0, prev);
      } catch (_) {
        uptimeBaseSecondsRef.value = 0;
      }
      try {
        if (global.__uptimeInterval) clearInterval(global.__uptimeInterval);
      } catch (_) {}
      try {
        global.__uptimeInterval = setInterval(() => { persistUptime(); }, 10000);
      } catch (_) {}
      // Persist once immediately
      persistUptime();

      // Perform WAHA preflight check
      try {
        logger.info('Server', 'Performing WAHA preflight check...');
        
        const containerStatus = await WAHAInitializer.dockerManager.getContainerStatus();
        
        logger.info('Server', 'WAHA Container Status:', {
          status: containerStatus.status,
          exists: containerStatus.exists,
          isRunning: containerStatus.isRunning,
          imageName: containerStatus.imageName
        });
        
        if (containerStatus.status === 'not-created') {
          logger.info('Server', 'WAHA container not found, will be created automatically');
        } else if (containerStatus.status === 'stopped') {
          logger.info('Server', 'WAHA container found but stopped, will be started automatically');
        } else if (containerStatus.status === 'running') {
          logger.info('Server', 'WAHA container is already running');
        }
        
        // Update memory service with container status
        await memoryService.updateStatus({
          wahaContainerStatus: containerStatus.status,
          wahaContainerExists: containerStatus.exists,
          wahaContainerRunning: containerStatus.isRunning
        });
        
      } catch (preflightError) {
        logger.error('Server', 'WAHA preflight check failed', preflightError);
        // Continue with initialization even if preflight fails
      }

      // Initialize WAHA with new initializer service
      try {
        const wahaInitializer = WAHAInitializer;
        const wahaErrorHandler = WAHAErrorHandler;
        
        logger.info('Server', 'Starting WAHA initialization with new initializer service...');
        
        // Initialize WAHA
        const initResult = await wahaInitializer.initialize();
        logger.info('Server', `WAHA initialization: ${initResult.success ? 'Success' : 'Failed'}`);
        if (initResult.success) {
          logger.info('Server', `Container started: ${initResult.containerStarted ? 'Yes' : 'No'}`);
          logger.info('Server', `Session status: ${initResult.sessionStatus}`);
          logger.info('Server', `Webhook configured: ${initResult.webhookConfigured ? 'Yes' : 'No'}`);
          
          // Update memory service with WAHA status
          await memoryService.updateStatus({
            wahaConnected: true,
            wahaSessionStatus: initResult.sessionStatus,
            wahaContainerStarted: initResult.containerStarted,
            wahaWebhookConfigured: initResult.webhookConfigured
          });
        } else {
          logger.warning('Server', 'WAHA initialization failed, continuing with existing session management');
        }
      } catch (e) {
        logger.error('Server', 'WAHA initialization failed (non-fatal)', e);
      }

      // Keep existing session ensure for backward compatibility
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

// Graceful shutdown: persist uptime before exit
function setupShutdownHandlers() {
  const handler = async () => {
    try { await persistUptime(); } catch (_) {}
    try { if (global.__uptimeInterval) clearInterval(global.__uptimeInterval); } catch (_) {}
    // Allow process to continue its default shutdown
  };
  try { process.on('SIGINT', handler); } catch (_) {}
  try { process.on('SIGTERM', handler); } catch (_) {}
}
setupShutdownHandlers();

module.exports = app;
