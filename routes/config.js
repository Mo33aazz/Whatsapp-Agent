const logger = require('../utils/logger');
const memoryService = require('../services/memoryService');
const openrouterService = require('../services/openrouterService');

function register(app) {
  // Save configuration
  app.post('/config', async (req, res) => {
    try {
      const { openrouterApiKey, aiModel, systemPrompt } = req.body || {};
      const existing = await memoryService.getConfig();

      let newApiKey = existing?.openrouterApiKey || '';
      if (typeof openrouterApiKey === 'string' && openrouterApiKey.trim()) {
        if (openrouterApiKey.trim() !== '***configured***') {
          newApiKey = openrouterApiKey.trim();
        }
      }

      const newConfig = {
        openrouterApiKey: newApiKey,
        aiModel: (aiModel || existing?.aiModel || 'openai/gpt-4o-mini'),
        systemPrompt: (systemPrompt || existing?.systemPrompt || 'You are a helpful WhatsApp assistant.'),
        wahaBaseUrl: existing?.wahaBaseUrl || process.env.WAHA_URL || 'http://localhost:3000',
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

  // Get configuration (mask API key)
  app.get('/config', async (req, res) => {
    try {
      const config = await memoryService.getConfig();
      const safeConfig = { ...config, openrouterApiKey: config.openrouterApiKey ? '***configured***' : '' };
      res.json({ success: true, config: safeConfig });
    } catch (error) {
      logger.error('Config', 'Error getting configuration', error);
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

      const normalized = String(level).toLowerCase() === 'warn' ? 'warning' : String(level).toLowerCase();
      logger.setLevel(normalized);

      try {
        const existing = await memoryService.getConfig();
        const updated = { ...(existing || {}), logLevel: normalized, lastUpdated: new Date().toISOString() };
        await memoryService.saveConfig(updated);
      } catch (_) {}

      res.json({ success: true, level: logger.getLevel() });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // OpenRouter testing endpoints
  app.post('/test-openrouter', async (req, res) => {
    try {
      const result = await openrouterService.testConnection();
      res.json({ success: true, result });
    } catch (error) {
      logger.error('OpenRouter', 'Error testing OpenRouter', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/config/test-openrouter', async (req, res) => {
    try {
      const { openrouterApiKey } = req.body;
      if (!openrouterApiKey) {
        return res.status(400).json({ success: false, message: 'OpenRouter API key is required' });
      }
      if (!openrouterApiKey.startsWith('sk-or-v1-') && !openrouterApiKey.startsWith('sk-')) {
        return res.status(400).json({ success: false, message: 'Invalid API key format. Must start with "sk-or-v1-" or "sk-"' });
      }

      const testResult = await openrouterService.testApiKey(openrouterApiKey);
      if (testResult.success) {
        res.json({ success: true, message: 'API key is valid and working', details: testResult.details });
      } else {
        res.status(400).json({ success: false, message: testResult.message || 'API key test failed' });
      }
    } catch (error) {
      logger.error('OpenRouter', 'Error testing OpenRouter API key', error);
      res.status(500).json({ success: false, message: 'Failed to test API key: ' + error.message });
    }
  });

  app.get('/openrouter/models', async (req, res) => {
    try {
      const apiKey = (req.query.apiKey || '').toString();
      const models = await openrouterService.getAvailableModels(apiKey);
      const ids = Array.isArray(models)
        ? models.map(m => (typeof m === 'string' ? m : (m?.id || ''))).filter(Boolean)
        : [];
      res.json({ success: true, models: ids });
    } catch (error) {
      logger.error('OpenRouter', 'Error fetching OpenRouter models', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
}

module.exports = { register };

