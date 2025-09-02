const WAHAInitializer = require('./wahaInitializer');
const logger = require('../utils/logger');

/**
 * WAHAErrorHandler for enhanced error handling and recovery
 * Handles specific WAHA-related errors and provides recovery mechanisms
 */
class WAHAErrorHandler {
  constructor(wahaInitializer = null) {
    this.logger = logger.child('WAHAErrorHandler');
    this.wahaInitializer = wahaInitializer || WAHAInitializer;
    this.errorCounts = new Map();
    this.maxErrorCount = 3;
    this.errorResetInterval = 5 * 60 * 1000; // 5 minutes
    this.recoveryStrategies = new Map();
    
    this.initializeRecoveryStrategies();
    this.startErrorCountReset();
  }

  /**
   * Initialize recovery strategies for different error types
   * @private
   */
  initializeRecoveryStrategies() {
    this.recoveryStrategies.set('422', async (error, context) => {
      return await this.handle422Error(error, context);
    });

    this.recoveryStrategies.set('ECONNREFUSED', async (error, context) => {
      return await this.handleConnectionRefused(error, context);
    });

    this.recoveryStrategies.set('TIMEOUT', async (error, context) => {
      return await this.handleTimeout(error, context);
    });

    this.recoveryStrategies.set('SESSION_NOT_WORKING', async (error, context) => {
      return await this.handleSessionNotWorking(error, context);
    });
  }

  /**
   * Handle 422 errors by restarting the session
   * @param {Error} error - The error object
   * @param {object} context - Error context
   * @returns {Promise<boolean>} True if recovery was successful
   */
  async handle422Error(error, context = {}) {
    try {
      this.logger.warning('Handling 422 error with session restart', {
        message: error.message,
        context,
        stack: error.stack
      });

      const sessionName = context.sessionName || 'default';
      const success = await this.wahaInitializer.handle422Error(sessionName);

      if (success) {
        this.logger.info('422 error recovery successful', { sessionName });
        this.recordRecovery('422');
        return true;
      }

      this.logger.error('422 error recovery failed', { sessionName });
      return false;
    } catch (recoveryError) {
      this.logger.error('422 error recovery threw error', {
        originalError: error.message,
        recoveryError: recoveryError.message,
        stack: recoveryError.stack
      });
      return false;
    }
  }

  /**
   * Handle connection refused errors by checking container status
   * @param {Error} error - The error object
   * @param {object} context - Error context
   * @returns {Promise<boolean>} True if recovery was successful
   */
  async handleConnectionRefused(error, context = {}) {
    try {
      this.logger.warning('Handling connection refused error', {
        message: error.message,
        context,
        stack: error.stack
      });

      // Check if container is running
      const containerStatus = await this.wahaInitializer.dockerManager.getContainerStatus();
      
      if (containerStatus.status !== 'running') {
        this.logger.info('Container is not running, attempting to start', containerStatus);
        
        const containerStarted = await this.wahaInitializer.dockerManager.ensureContainerRunning();
        
        if (containerStarted) {
          this.logger.info('Container started successfully after connection refused error');
          this.recordRecovery('ECONNREFUSED');
          return true;
        }
        
        this.logger.error('Failed to start container after connection refused error');
        return false;
      }

      // Container is running but still getting connection refused
      this.logger.warning('Container is running but connection refused persists');
      
      // Try to restart the session
      try {
        await this.wahaInitializer.sessionInitializer.handle422Error();
        this.logger.info('Session restart resolved connection refused error');
        this.recordRecovery('ECONNREFUSED');
        return true;
      } catch (sessionError) {
        this.logger.error('Session restart failed to resolve connection refused', sessionError);
        return false;
      }
    } catch (recoveryError) {
      this.logger.error('Connection refused error recovery threw error', {
        originalError: error.message,
        recoveryError: recoveryError.message,
        stack: recoveryError.stack
      });
      return false;
    }
  }

  /**
   * Handle timeout errors with retry logic
   * @param {Error} error - The error object
   * @param {object} context - Error context
   * @returns {Promise<boolean>} True if recovery was successful
   */
  async handleTimeout(error, context = {}) {
    try {
      this.logger.warning('Handling timeout error', {
        message: error.message,
        context,
        stack: error.stack
      });

      const { operation, timeout = 30000 } = context;
      
      // Wait a bit before retrying
      await new Promise(resolve => setTimeout(resolve, Math.min(timeout, 10000)));
      
      // Try the operation again if provided
      if (operation && typeof operation === 'function') {
        try {
          const result = await operation();
          this.logger.info('Timeout error recovery successful through retry');
          this.recordRecovery('TIMEOUT');
          return true;
        } catch (retryError) {
          this.logger.error('Timeout retry failed', retryError);
          return false;
        }
      }

      // If no operation provided, assume it's a WAHA connection issue
      const wahaRunning = await this.wahaInitializer.checkWahaConnection();
      
      if (!wahaRunning) {
        this.logger.info('WAHA not running after timeout, attempting re-initialization');
        const initResult = await this.wahaInitializer.reinitialize();
        this.recordRecovery('TIMEOUT');
        return initResult.success;
      }

      this.logger.info('WAHA is running, timeout may be transient');
      this.recordRecovery('TIMEOUT');
      return true;
    } catch (recoveryError) {
      this.logger.error('Timeout error recovery threw error', {
        originalError: error.message,
        recoveryError: recoveryError.message,
        stack: recoveryError.stack
      });
      return false;
    }
  }

  /**
   * Handle session not working errors
   * @param {Error} error - The error object
   * @param {object} context - Error context
   * @returns {Promise<boolean>} True if recovery was successful
   */
  async handleSessionNotWorking(error, context = {}) {
    try {
      this.logger.warning('Handling session not working error', {
        message: error.message,
        context,
        stack: error.stack
      });

      const sessionName = context.sessionName || 'default';
      
      // Try to recreate the session
      try {
        await this.wahaInitializer.sessionInitializer.recreateSessionWithWebhook();
        this.logger.info('Session recreation resolved session not working error', { sessionName });
        this.recordRecovery('SESSION_NOT_WORKING');
        return true;
      } catch (recreateError) {
        this.logger.error('Session recreation failed', recreateError);
        
        // Try to restart the session instead
        try {
          await this.wahaInitializer.sessionInitializer.handle422Error(sessionName);
          this.logger.info('Session restart resolved session not working error', { sessionName });
          this.recordRecovery('SESSION_NOT_WORKING');
          return true;
        } catch (restartError) {
          this.logger.error('Session restart also failed', restartError);
          return false;
        }
      }
    } catch (recoveryError) {
      this.logger.error('Session not working error recovery threw error', {
        originalError: error.message,
        recoveryError: recoveryError.message,
        stack: recoveryError.stack
      });
      return false;
    }
  }

  /**
   * Main error handling method
   * @param {Error} error - The error object
   * @param {object} context - Error context
   * @returns {Promise<{handled: boolean, recovered: boolean, error: Error}>} Handling result
   */
  async handleError(error, context = {}) {
    try {
      this.logger.error('Handling WAHA error', {
        message: error.message,
        context,
        stack: error.stack
      });

      // Increment error count
      this.incrementErrorCount(error);

      // Determine error type
      const errorType = this.determineErrorType(error);
      
      // Check if we should attempt recovery
      if (!this.shouldAttemptRecovery(errorType)) {
        this.logger.info('Error recovery not attempted, threshold exceeded', {
          errorType,
          errorCount: this.getErrorCount(errorType)
        });
        return { handled: true, recovered: false, error };
      }

      // Get recovery strategy
      const recoveryStrategy = this.recoveryStrategies.get(errorType);
      
      if (!recoveryStrategy) {
        this.logger.warning('No recovery strategy found for error type', { errorType });
        return { handled: true, recovered: false, error };
      }

      // Attempt recovery
      const recovered = await recoveryStrategy(error, context);
      
      this.logger.info('Error handling completed', {
        errorType,
        recovered,
        errorCount: this.getErrorCount(errorType)
      });

      return { handled: true, recovered, error };
    } catch (handlingError) {
      this.logger.error('Error handling threw exception', {
        originalError: error.message,
        handlingError: handlingError.message,
        stack: handlingError.stack
      });
      return { handled: false, recovered: false, error: handlingError };
    }
  }

  /**
   * Determine error type from error object
   * @param {Error} error - The error object
   * @returns {string} Error type
   */
  determineErrorType(error) {
    if (error.response?.status === 422) {
      return '422';
    }
    
    if (error.code === 'ECONNREFUSED' || error.message.includes('ECONNREFUSED')) {
      return 'ECONNREFUSED';
    }
    
    if (error.code === 'ETIMEDOUT' || error.code === 'TIMEOUT' || error.message.includes('timeout')) {
      return 'TIMEOUT';
    }
    
    if (error.message.includes('not working') || error.message.includes('SESSION_NOT_WORKING')) {
      return 'SESSION_NOT_WORKING';
    }
    
    return 'UNKNOWN';
  }

  /**
   * Check if recovery should be attempted
   * @param {string} errorType - Type of error
   * @returns {boolean} True if recovery should be attempted
   */
  shouldAttemptRecovery(errorType) {
    const count = this.getErrorCount(errorType);
    return count < this.maxErrorCount;
  }

  /**
   * Increment error count for error type
   * @param {string} errorType - Type of error
   */
  incrementErrorCount(error) {
    const errorType = this.determineErrorType(error);
    const currentCount = this.getErrorCount(errorType);
    this.errorCounts.set(errorType, currentCount + 1);
    
    this.logger.debug('Error count incremented', {
      errorType,
      count: currentCount + 1,
      maxCount: this.maxErrorCount
    });
  }

  /**
   * Get error count for error type
   * @param {string} errorType - Type of error
   * @returns {number} Error count
   */
  getErrorCount(errorType) {
    return this.errorCounts.get(errorType) || 0;
  }

  /**
   * Record successful recovery
   * @param {string} errorType - Type of error
   */
  recordRecovery(errorType) {
    this.logger.info('Recovery recorded', { errorType });
    // Reset error count on successful recovery
    this.errorCounts.set(errorType, 0);
  }

  /**
   * Start periodic error count reset
   * @private
   */
  startErrorCountReset() {
    setInterval(() => {
      this.logger.debug('Resetting error counts');
      this.errorCounts.clear();
    }, this.errorResetInterval);
  }

  /**
   * Get error statistics
   * @returns {object} Error statistics
   */
  getErrorStats() {
    const stats = {};
    for (const [errorType, count] of this.errorCounts.entries()) {
      stats[errorType] = {
        count,
        maxCount: this.maxErrorCount,
        canRecover: this.shouldAttemptRecovery(errorType)
      };
    }
    return stats;
  }

  /**
   * Reset error statistics
   */
  resetErrorStats() {
    this.errorCounts.clear();
    this.logger.info('Error statistics reset');
  }

  /**
   * Add custom recovery strategy
   * @param {string} errorType - Error type to handle
   * @param {Function} strategy - Recovery strategy function
   */
  addRecoveryStrategy(errorType, strategy) {
    this.recoveryStrategies.set(errorType, strategy);
    this.logger.info('Custom recovery strategy added', { errorType });
  }

  /**
   * Remove recovery strategy
   * @param {string} errorType - Error type to remove
   */
  removeRecoveryStrategy(errorType) {
    this.recoveryStrategies.delete(errorType);
    this.logger.info('Recovery strategy removed', { errorType });
  }

  /**
   * Get all registered recovery strategies
   * @returns {Map} Map of error types to strategies
   */
  getRecoveryStrategies() {
    return new Map(this.recoveryStrategies);
  }
}

// Export singleton instance for consistency
module.exports = new WAHAErrorHandler();

// Export class for custom instances
module.exports.WAHAErrorHandler = WAHAErrorHandler;