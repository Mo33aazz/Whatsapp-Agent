const logger = require('../utils/logger');
const wahaService = require('../services/wahaService');

function register(app) {
  app.delete('/api/sessions/:session', async (req, res) => {
    try {
      const { session } = req.params;
      logger.info('Session', `Attempting to delete session on WAHA: ${session}`);
      const result = await wahaService.deleteSession(session);
      logger.info('Session', `Session ${session} delete result`, result);
      res.json({ success: true, message: `Session ${session} deleted on WAHA`, result });
    } catch (error) {
      logger.error('Session', `Error deleting session ${req.params.session}`, error);
      res.status(500).json({ success: false, error: error.message, message: `Failed to delete session ${req.params.session}` });
    }
  });

  app.post('/api/sessions/:session/logout', async (req, res) => {
    try {
      const { session } = req.params;
      logger.info('Session', `Attempting to logout session on WAHA: ${session}`);
      const result = await wahaService.logoutSession(session);
      logger.info('Session', `Session ${session} logout result`, result);
      res.json({ success: true, message: `Session ${session} logged out on WAHA`, result });
    } catch (error) {
      logger.error('Session', `Error logging out session ${req.params.session}`, error);
      res.status(500).json({ success: false, error: error.message, message: `Failed to logout session ${req.params.session}` });
    }
  });

  app.post('/api/sessions/:session/restart', async (req, res) => {
    try {
      const { session } = req.params;
      logger.info('Session', `Attempting to restart session on WAHA: ${session}`);
      const result = await wahaService.restartSession(session);
      logger.info('Session', `Session ${session} restart result`, result);
      res.json({ success: true, message: `Session ${session} restart requested on WAHA`, result });
    } catch (error) {
      logger.error('Session', `Error restarting session ${req.params.session}`, error);
      res.status(500).json({ success: false, error: error.message, message: `Failed to restart session ${req.params.session}` });
    }
  });
}

module.exports = { register };

