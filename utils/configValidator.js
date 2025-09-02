const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class ConfigValidator {
  /**
   * Validate and create necessary directories
   */
  static validateDirectories() {
    const directories = [
      path.join(__dirname, '..', 'data'),
      path.join(__dirname, '..', 'logs')
    ];
    
    directories.forEach(dir => {
      if (!fs.existsSync(dir)) {
        try {
          fs.mkdirSync(dir, { recursive: true });
          logger.info('Config', `Created directory: ${dir}`);
        } catch (error) {
          logger.error(`Failed to create directory ${dir}`, 'Config', { dir, error: error.message });
          throw error;
        }
      }
    });
  }
  
  /**
   * Validate environment variables
   */
  static validateEnvironment() {
    const config = {
      port: this.validatePort(),
      waha: this.validateWahaConfig(),
      openrouter: this.validateOpenRouterConfig(),
      memory: this.validateMemoryConfig(),
      security: this.validateSecurityConfig()
    };
    
    return config;
  }
  
  /**
   * Validate port configuration
   */
  static validatePort() {
    const port = process.env.PORT || '3001';
    const portNum = parseInt(port);
    
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      throw new Error(`Invalid PORT: ${port}. Must be a number between 1 and 65535.`);
    }
    
    return portNum;
  }
  
  /**
   * Validate WAHA configuration
   */
  static validateWahaConfig() {
    const sessionName = process.env.WAHA_SESSION_NAME || 'default';
    let wahaUrl = process.env.WAHA_URL || 'http://localhost:3000';

    // Ensure it looks like a URL; if not, fall back to sensible default
    if (typeof wahaUrl !== 'string' || (!wahaUrl.startsWith('http://') && !wahaUrl.startsWith('https://'))) {
      logger.warn('Config', 'WAHA_URL is missing or invalid. Falling back to http://localhost:3000');
      wahaUrl = 'http://localhost:3000';
    }

    try {
      // Validate URL format; on failure, use default but do not crash startup
      // This keeps startup smooth even if env is misconfigured
      // eslint-disable-next-line no-new
      new URL(wahaUrl);
    } catch (error) {
      logger.warn('Config', `Invalid WAHA_URL format '${wahaUrl}'. Using http://localhost:3000`);
      wahaUrl = 'http://localhost:3000';
    }

    return {
      url: wahaUrl,
      sessionName
    };
  }
  
  /**
   * Validate OpenRouter configuration
   */
  static validateOpenRouterConfig() {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const model = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
    const systemPrompt = process.env.SYSTEM_PROMPT || 'You are a helpful AI assistant for WhatsApp. Be concise and friendly in your responses. Keep messages under 2000 characters.';
    
    // Check API key from environment first, then from config file
    let finalApiKey = apiKey;
    let isConfigured = !!apiKey && apiKey !== 'your_openrouter_api_key_here' && apiKey !== '';
    
    // If not configured in env, check config file
    if (!isConfigured) {
      try {
        const fs = require('fs');
        const path = require('path');
        const configPath = path.join(__dirname, '..', 'data', 'config.json');
        
        if (fs.existsSync(configPath)) {
          const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          const configApiKey = configData.openrouterApiKey;
          
          if (configApiKey && configApiKey !== 'your-openrouter-api-key-here' && configApiKey !== '') {
            finalApiKey = configApiKey;
            isConfigured = true;
            logger.info('Config', 'OpenRouter API key loaded from config file');
          }
        }
      } catch (error) {
        logger.debug('Config', 'Could not read config file for OpenRouter API key', { error: error.message });
      }
    }
    
    // Validate API key format if present
    if (finalApiKey && !finalApiKey.startsWith('sk-')) {
      logger.warn('Config', 'OPENROUTER_API_KEY should start with "sk-"');
    }
    
    return {
      apiKey: finalApiKey || null,
      model: model,
      systemPrompt: systemPrompt,
      configured: isConfigured
    };
  }
  
  /**
   * Validate memory configuration
   */
  static validateMemoryConfig() {
    const conversationsPath = process.env.MEMORY_FILE_PATH || './data/conversations.json';
    const configPath = process.env.CONFIG_FILE_PATH || './data/config.json';
    const statusPath = process.env.STATUS_FILE_PATH || './data/status.json';
    
    // Ensure paths are absolute
    const basePath = path.join(__dirname, '..');
    
    return {
      conversationsPath: path.resolve(basePath, conversationsPath),
      configPath: path.resolve(basePath, configPath),
      statusPath: path.resolve(basePath, statusPath)
    };
  }
  
  /**
   * Validate security configuration
   */
  static validateSecurityConfig() {
    const corsOrigin = process.env.CORS_ORIGIN || '*';
    const helmetEnabled = process.env.HELMET_ENABLED !== 'false';
    const rateLimitWindow = parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000;
    const rateLimitMax = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100;
    
    return {
      corsOrigin: corsOrigin,
      helmetEnabled: helmetEnabled,
      rateLimit: {
        windowMs: rateLimitWindow,
        max: rateLimitMax
      }
    };
  }
  
  /**
   * Validate webhook configuration
   */
  static validateWebhookConfig() {
    // Default to the WAHA events endpoint path used by this server
    const webhookPath = process.env.WEBHOOK_PATH || '/waha-events';
    
    if (!webhookPath.startsWith('/')) {
      throw new Error('WEBHOOK_PATH must start with "/"');
    }
    
    return {
      path: webhookPath
    };
  }
  
  /**
   * Get complete validated configuration
   */
  static getValidatedConfig() {
    try {
      // Validate directories first
      this.validateDirectories();
      
      // Validate all configuration sections
      const config = {
        port: this.validatePort(),
        waha: this.validateWahaConfig(),
        openrouter: this.validateOpenRouterConfig(),
        memory: this.validateMemoryConfig(),
        security: this.validateSecurityConfig(),
        webhook: this.validateWebhookConfig(),
        nodeEnv: process.env.NODE_ENV || 'development',
        logLevel: process.env.LOG_LEVEL || 'info'
      };
      
      logger.info('Config', 'Configuration validation successful');
      
      // Log warnings for missing optional configurations
      if (!config.openrouter.configured) {
        logger.warn('Config', 'OpenRouter API key not configured. AI functionality will be disabled.');
      }
      
      return config;
    } catch (error) {
      logger.error('Configuration validation failed', 'Config', { error: error.message });
      throw error;
    }
  }
  
  /**
   * Print configuration summary
   */
  static printConfigSummary(config) {
    if (logger.isLevelEnabled('DEBUG')) {
      logger.info('Config', '\n=== WhatsApp AI Bot Configuration ===');
      logger.info('Config', `Port: ${config.port}`);
      logger.info('Config', `Environment: ${config.nodeEnv}`);
      logger.info('Config', `WAHA URL: ${config.waha.url}`);
      logger.info('Config', `WAHA Session: ${config.waha.sessionName}`);
      logger.info('Config', `OpenRouter Configured: ${config.openrouter.configured ? 'Yes' : 'No'}`);
      logger.info('Config', `OpenRouter Model: ${config.openrouter.model}`);
      // Clarify the actual events endpoint path
      logger.info('Config', `Events Endpoint Path: ${config.webhook.path}`);
      logger.info('Config', `CORS Origin: ${config.security.corsOrigin}`);
      logger.info('Config', `Rate Limit: ${config.security.rateLimit.max} requests per ${config.security.rateLimit.windowMs}ms`);
      logger.info('Config', '=====================================\n');
    } else {
      // Compact summary for non-debug mode
      const summary = `port=${config.port}, env=${config.nodeEnv}, waha=${config.waha.url}, session=${config.waha.sessionName}, openrouter=${config.openrouter.configured ? 'on' : 'off'}, eventsPath=${config.webhook.path}`;
      logger.info('Config', `Configuration loaded (${summary})`);
    }
  }
}

module.exports = ConfigValidator;
