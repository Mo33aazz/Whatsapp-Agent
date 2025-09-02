const path = require('path');
const errorHandler = require('../utils/errorHandler');
const memoryService = require('../services/memoryService');
const wahaService = require('../services/wahaService');
const logger = require('../utils/logger');

function register(app, helpers) {
  const { formatUptime, uptimeBaseSecondsRef } = helpers;

  app.get('/status', async (req, res) => {
    try {
      const status = await memoryService.getStatus();
      const wahaConnected = await wahaService.checkConnection();
      const config = await memoryService.getConfig();
      const openrouterConfigured = !!(config && typeof config.openrouterApiKey === 'string' && config.openrouterApiKey.trim().startsWith('sk-'));

      let sessionStatus = 'UNKNOWN';
      let isAuthenticated = false;
      try {
        const rawSession = await wahaService.getSessionStatus();
        sessionStatus = (typeof rawSession === 'string') ? rawSession : (rawSession && typeof rawSession.status === 'string' ? rawSession.status : 'UNKNOWN');
        if (typeof wahaService.isAuthenticated === 'function') {
          isAuthenticated = await wahaService.isAuthenticated();
        } else {
          isAuthenticated = (sessionStatus === 'WORKING' || sessionStatus === 'AUTHENTICATED');
        }
      } catch (error) {
        logger.warning('Status', 'Could not get session status', error);
      }

      const uptimeSeconds = Math.floor(uptimeBaseSecondsRef.value + process.uptime());
      const uptimeString = formatUptime(uptimeSeconds);

      res.json({
        wahaConnected,
        openrouterConfigured,
        sessionStatus,
        isAuthenticated,
        systemReady: Boolean(wahaConnected && isAuthenticated),
        messagesProcessed: status.messagesProcessed || 0,
        uptime: uptimeString,
        uptimeSeconds,
        lastMessageAt: status.lastMessageAt,
        errors: status.errors || []
      });
    } catch (error) {
      logger.error('Status', 'Error getting status', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/conversations', async (req, res) => {
    try {
      const conversations = await memoryService.getAllConversations();
      res.json({ success: true, conversations });
    } catch (error) {
      logger.error('Conversations', 'Error getting conversations', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.delete('/conversations', async (req, res) => {
    try {
      const rootDir = path.join(__dirname, '..');
      await memoryService.writeJsonFile(
        path.join(rootDir, 'data', 'conversations.json'),
        {}
      );
      memoryService.clearCache();
      res.json({ success: true, message: 'All conversations cleared' });
    } catch (error) {
      logger.error('Conversations', 'Error clearing conversations', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

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
}

module.exports = { register };

