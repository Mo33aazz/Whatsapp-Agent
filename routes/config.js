const logger = require('../utils/logger');
const memoryService = require('../services/memoryService');
const openrouterService = require('../services/openrouterService');

// Helper function to generate system prompt with products
function generateSystemPromptWithProducts(basePrompt, products) {
  if (!basePrompt) {
    basePrompt = 'You are a helpful AI assistant for WhatsApp. Be concise and friendly in your responses. Keep messages under 2000 characters.';
  }
  
  if (!products || !Array.isArray(products) || products.length === 0) {
    return basePrompt;
  }
  
  let productsSection = '\n\nAvailable Products/Services:\n';
  products.forEach((product, index) => {
    const name = product.name || 'Unnamed Product';
    const price = product.price || 'Price not specified';
    const note = product.note ? ` - ${product.note}` : '';
    productsSection += `${index + 1}. ${name} - ${price}${note}\n`;
  });
  
  return basePrompt + productsSection;
}

function register(app) {
  // Save configuration
  app.post('/config', async (req, res) => {
    try {
      const { openrouterApiKey, aiModel, systemPrompt, products } = req.body || {};
      const existing = await memoryService.getConfig();

      let newApiKey = existing?.openrouterApiKey || '';
      if (typeof openrouterApiKey === 'string' && openrouterApiKey.trim()) {
        if (openrouterApiKey.trim() !== '***configured***') {
          newApiKey = openrouterApiKey.trim();
        }
      }

      // Generate enhanced system prompt with products/services
      const enhancedSystemPrompt = generateSystemPromptWithProducts(systemPrompt, products);

      const newConfig = {
        openrouterApiKey: newApiKey,
        aiModel: (aiModel || existing?.aiModel || 'openai/gpt-4o-mini'),
        systemPrompt: enhancedSystemPrompt,
        products: products || [],
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
      const safeConfig = {
        ...config,
        openrouterApiKey: config.openrouterApiKey ? '***configured***' : '',
        products: config.products || []
      };
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

  // Products management endpoint
  app.post('/config/products', async (req, res) => {
    try {
      const { products } = req.body || {};
      if (!Array.isArray(products)) {
        return res.status(400).json({ success: false, message: 'Products must be an array' });
      }

      const existing = await memoryService.getConfig();
      const newConfig = {
        ...existing,
        products: products,
        lastUpdated: new Date().toISOString()
      };

      await memoryService.saveConfig(newConfig);
      res.json({ success: true, message: 'Products saved successfully', products });
    } catch (error) {
      logger.error('Config', 'Error saving products', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get products endpoint
  app.get('/config/products', async (req, res) => {
    try {
      const config = await memoryService.getConfig();
      const products = config.products || [];
      res.json({ success: true, products });
    } catch (error) {
      logger.error('Config', 'Error getting products', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
}

module.exports = { register };

