const memoryService = require('../services/memoryService');

class ErrorHandler {
  constructor() {
    this.setupGlobalErrorHandlers();
  }

  /**
   * Setup global error handlers for uncaught exceptions and rejections
   */
  setupGlobalErrorHandlers() {
    // Handle uncaught exceptions
    process.on('uncaughtException', async (error) => {
      console.error('Uncaught Exception:', error);
      await this.logError('Uncaught Exception', error);
      
      // Graceful shutdown
      process.exit(1);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', async (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
      await this.logError('Unhandled Rejection', reason);
    });

    // Handle SIGTERM and SIGINT for graceful shutdown
    process.on('SIGTERM', this.gracefulShutdown.bind(this));
    process.on('SIGINT', this.gracefulShutdown.bind(this));
  }

  /**
   * Log error to memory service
   * @param {string} type - Error type
   * @param {Error|string} error - Error object or message
   */
  async logError(type, error) {
    try {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : '';
      
      await memoryService.addError(`${type}: ${errorMessage}`);
      
      if (errorStack) {
        console.error('Stack trace:', errorStack);
      }
    } catch (logError) {
      console.error('Failed to log error:', logError);
    }
  }

  /**
   * Handle graceful shutdown
   */
  async gracefulShutdown() {
    console.log('Received shutdown signal, shutting down gracefully...');
    
    try {
      // Update status to indicate shutdown
      await memoryService.updateStatus({
        wahaConnected: false,
        lastHealthCheck: new Date().toISOString()
      });
      
      console.log('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      console.error('Error during graceful shutdown:', error);
      process.exit(1);
    }
  }

  /**
   * Express error handler middleware
   * @param {Error} err - Error object
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next function
   */
  async expressErrorHandler(err, req, res, next) {
    console.error('Express error:', err);
    
    await this.logError('Express Error', err);
    
    // Don't expose internal errors in production
    const isDevelopment = process.env.NODE_ENV === 'development';
    const errorMessage = isDevelopment ? err.message : 'Internal server error';
    
    res.status(err.status || 500).json({
      success: false,
      error: errorMessage,
      ...(isDevelopment && { stack: err.stack })
    });
  }

  /**
   * Validate environment configuration
   * @returns {Object} Validation result
   */
  validateEnvironment() {
    const required = [
      'PORT',
      'WAHA_URL',
      'WAHA_SESSION_NAME'
    ];
    
    const optional = [
      'OPENROUTER_API_KEY',
      'OPENROUTER_MODEL',
      'SYSTEM_PROMPT',
      'NODE_ENV'
    ];
    
    const missing = [];
    const warnings = [];
    
    // Check required variables
    required.forEach(key => {
      if (!process.env[key]) {
        missing.push(key);
      }
    });
    
    // Check optional variables
    optional.forEach(key => {
      if (!process.env[key]) {
        warnings.push(key);
      }
    });
    
    // Validate PORT
    const port = parseInt(process.env.PORT);
    if (isNaN(port) || port < 1 || port > 65535) {
      missing.push('PORT (must be a valid port number)');
    }
    
    // Validate WAHA_URL format
    if (process.env.WAHA_URL && !process.env.WAHA_URL.startsWith('http')) {
      missing.push('WAHA_URL (must start with http:// or https://)');
    }
    
    return {
      valid: missing.length === 0,
      missing,
      warnings,
      summary: missing.length === 0 
        ? 'Environment configuration is valid' 
        : `Missing required environment variables: ${missing.join(', ')}`
    };
  }

  /**
   * Check system health
   * @returns {Object} Health check result
   */
  async checkSystemHealth() {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      checks: {}
    };
    
    try {
      // Check memory service
      const status = await memoryService.getStatus();
      health.checks.memoryService = {
        status: 'ok',
        lastCheck: status.lastHealthCheck || 'never'
      };
    } catch (error) {
      health.checks.memoryService = {
        status: 'error',
        error: error.message
      };
      health.status = 'unhealthy';
    }
    
    // Check data directory
    try {
      const fs = require('fs');
      const path = require('path');
      const dataDir = path.join(__dirname, '..', 'data');
      
      if (fs.existsSync(dataDir)) {
        health.checks.dataDirectory = { status: 'ok' };
      } else {
        health.checks.dataDirectory = { 
          status: 'warning', 
          message: 'Data directory does not exist' 
        };
      }
    } catch (error) {
      health.checks.dataDirectory = {
        status: 'error',
        error: error.message
      };
      health.status = 'unhealthy';
    }
    
    return health;
  }
}

module.exports = new ErrorHandler();