const fs = require('fs');
const path = require('path');

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
          console.log(`Created directory: ${dir}`);
        } catch (error) {
          console.error(`Failed to create directory ${dir}:`, error.message);
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
    const wahaUrl = process.env.WAHA_URL;
    const sessionName = process.env.WAHA_SESSION_NAME || 'default';
    
    if (!wahaUrl) {
      throw new Error('WAHA_URL is required');
    }
    
    if (!wahaUrl.startsWith('http://') && !wahaUrl.startsWith('https://')) {
      throw new Error('WAHA_URL must start with http:// or https://');
    }
    
    try {
      new URL(wahaUrl);
    } catch (error) {
      throw new Error(`Invalid WAHA_URL format: ${wahaUrl}`);
    }
    
    return {
      url: wahaUrl,
      sessionName: sessionName
    };
  }
  
  /**
   * Validate OpenRouter configuration
   */
  static validateOpenRouterConfig() {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const model = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
    const systemPrompt = process.env.SYSTEM_PROMPT || 'You are a helpful AI assistant for WhatsApp. Be concise and friendly in your responses. Keep messages under 2000 characters.';
    
    // API key is optional at startup but required for AI functionality
    if (apiKey && !apiKey.startsWith('sk-')) {
      console.warn('Warning: OPENROUTER_API_KEY should start with "sk-"');
    }
    
    return {
      apiKey: apiKey || null,
      model: model,
      systemPrompt: systemPrompt,
      configured: !!apiKey && apiKey !== 'your_openrouter_api_key_here'
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
    const webhookPath = process.env.WEBHOOK_PATH || '/webhook';
    
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
      
      console.log('Configuration validation successful');
      
      // Log warnings for missing optional configurations
      if (!config.openrouter.configured) {
        console.warn('Warning: OpenRouter API key not configured. AI functionality will be disabled.');
      }
      
      return config;
    } catch (error) {
      console.error('Configuration validation failed:', error.message);
      throw error;
    }
  }
  
  /**
   * Print configuration summary
   */
  static printConfigSummary(config) {
    console.log('\n=== WhatsApp AI Bot Configuration ===');
    console.log(`Port: ${config.port}`);
    console.log(`Environment: ${config.nodeEnv}`);
    console.log(`WAHA URL: ${config.waha.url}`);
    console.log(`WAHA Session: ${config.waha.sessionName}`);
    console.log(`OpenRouter Configured: ${config.openrouter.configured ? 'Yes' : 'No'}`);
    console.log(`OpenRouter Model: ${config.openrouter.model}`);
    console.log(`Webhook Path: ${config.webhook.path}`);
    console.log(`CORS Origin: ${config.security.corsOrigin}`);
    console.log(`Rate Limit: ${config.security.rateLimit.max} requests per ${config.security.rateLimit.windowMs}ms`);
    console.log('=====================================\n');
  }
}

module.exports = ConfigValidator;