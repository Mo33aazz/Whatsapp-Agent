const logger = require('../utils/logger');
const sseHub = require('../lib/sseHub');
const wahaService = require('../services/wahaService');
const messageProcessor = require('../services/messageProcessor');

function register(app) {
  // Primary webhook endpoint for WAHA events
  app.post(['/waha-events', '/webhook'], async (req, res) => {
    const timestamp = new Date().toISOString();
    logger.info('Webhook', 'Webhook received at /waha-events');

    res.status(200).json({ status: 'received' });

    logger.debug('Webhook', 'Webhook details', {
      event: req.body?.event,
      session: req.body?.session,
      payloadKeys: Object.keys(req.body?.payload || {}),
      contentType: req.headers['content-type'],
      userAgent: req.headers['user-agent']
    });

    try {
      const event = req.body;
      logger.info('Webhook', `Processing event: ${event.event}`);
      try {
        sseHub.broadcast({ type: event.event || 'unknown', session: event.session || 'default', payload: event.payload || {}, timestamp });
      } catch (_) {}

      if (event.event === 'ready' || event.event === 'auth' || event.event === 'state.change') {
        logger.info('Webhook', 'Setting up webhook for session state change...');
        await wahaService.setupWebhookAfterAuth(event.session || 'default');
      }

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

  // Secondary (disabled) duplicate endpoint retained for compatibility
  app.post('/waha-events-dup-disabled', async (req, res) => {
    const timestamp = new Date().toISOString();
    logger.debug('Webhook', 'WAHA Webhook Event Received');
    logger.debug('Webhook', 'Headers', req.headers);
    logger.debug('Webhook', 'Body', req.body);
    logger.debug('Webhook', 'Query', req.query);

    try {
      const event = req.body;
      try { sseHub.broadcast({ type: event.event || 'unknown', session: event.session || 'default', payload: event.payload || {}, timestamp }); } catch (_) {}

      try {
        if (event.event === 'ready' || event.event === 'auth' || (event.event === 'state.change' && (event.payload?.state === 'CONNECTED' || event.payload?.state === 'OPEN'))) {
          await wahaService.setupWebhookAfterAuth(event.session || 'default');
        }
      } catch (_) {}

      if (event.event === 'message') {
        logger.info('Webhook', 'Processing message event...');
        await messageProcessor.processMessage(event.payload);
      } else if (event.event === 'session.status') {
        logger.info('Webhook', `Session status changed: ${event.payload.status}`);
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

  // Debug webhook endpoints (GET: info, POST: force reconfigure)
  app.get('/debug-webhook', async (req, res) => {
    try {
      logger.debug('Debug', 'Debug webhook endpoint called');

      const sessionName = req.query.session || 'default';
      const wahaUrl = process.env.WAHA_URL || 'http://localhost:3000';

      const sessionStatus = await wahaService.getSessionStatus(sessionName);
      logger.debug('Debug', `Session '${sessionName}' status`, sessionStatus);

      const isAuth = await wahaService.isAuthenticated(sessionName);
      logger.debug('Debug', `Session '${sessionName}' authenticated: ${isAuth}`);

      let webhookConfig = null;
      try {
        const response = await fetch(`${wahaUrl}/api/sessions/${sessionName}/webhooks`, {
          method: 'GET', headers: { 'Content-Type': 'application/json' }
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
      res.status(500).json({ error: error.message, timestamp: new Date().toISOString() });
    }
  });

  app.post('/debug-webhook', async (req, res) => {
    try {
      logger.info('Debug', 'Forcing webhook reconfiguration...');
      await wahaService.configureWahaEventsWebhook();
      logger.info('Debug', 'Webhook reconfiguration completed');
      res.json({ success: true, message: 'Webhook reconfigured successfully', timestamp: new Date().toISOString() });
    } catch (error) {
      logger.error('Debug', 'Error reconfiguring webhook', error);
      res.status(500).json({ success: false, error: error.message, timestamp: new Date().toISOString() });
    }
  });
}

module.exports = { register };

