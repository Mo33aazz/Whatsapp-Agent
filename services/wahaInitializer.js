const DockerManager = require('../utils/dockerManager');
const SessionInitializer = require('../utils/sessionInitializer');
const logger = require('../utils/logger');

/**
 * WAHAInitializer main service that coordinates container and session management
 * Handles the complete initialization sequence for WAHA with proper error handling
 */
class WAHAInitializer {
  constructor() {
    this.logger = logger.child('WAHAInitializer');
    this.dockerManager = DockerManager;
    this.sessionInitializer = SessionInitializer;
    this.containerStarted = false;
    this.maxRetries = 3;
    this.retryDelay = 5000;
    this.initializationComplete = false;
  }

  /**
   * Initialize WAHA with complete sequence
   * @returns {Promise<object>} Initialization result
   */
  async initialize() {
    try {
      this.logger.info('Starting WAHA initialization sequence...');

      // Step 1: Check if WAHA is running
      const wahaRunning = await this.checkWahaConnection();
      
      if (!wahaRunning) {
        this.logger.info('WAHA not running, starting container...');
        this.containerStarted = await this.dockerManager.ensureContainerRunning();
        
        if (this.containerStarted) {
          this.logger.info('WAHA container started successfully');
        } else {
          throw new Error('Failed to start WAHA container');
        }
      } else {
        this.logger.info('WAHA already running, skipping container start');
        this.containerStarted = false;
      }

      // Step 2: Handle session management (conditional)
      if (this.containerStarted) {
        this.logger.info('Container was started, recreating session...');
        await this.sessionInitializer.recreateSessionWithWebhook();
      } else {
        this.logger.info('Validating existing session configuration...');
        await this.sessionInitializer.validateExistingSession();
      }

      // Step 3: Validate session and webhook
      const validation = await this.sessionInitializer.validateSessionAndWebhook();
      
      if (!validation.valid) {
        this.logger.warning('Session validation failed, retrying...');
        return await this.retryInitialization();
      }

      this.initializationComplete = true;
      this.logger.info('WAHA initialization completed successfully', {
        containerStarted: this.containerStarted,
        sessionStatus: validation.status,
        webhookConfigured: validation.webhookConfigured
      });

      return {
        success: true,
        containerStarted: this.containerStarted,
        sessionStatus: validation.status,
        webhookConfigured: validation.webhookConfigured,
        sessionInfo: validation.sessionInfo
      };

    } catch (error) {
      this.logger.error('WAHA initialization failed', error);
      throw error;
    }
  }

  /**
   * Check if WAHA is running and accessible
   * @returns {Promise<boolean>} True if WAHA is running
   */
  async checkWahaConnection() {
    try {
      this.logger.debug('Checking WAHA connection');
      
      const response = await fetch(`${this.getWahaUrl()}/api/sessions`, {
        method: 'GET',
        timeout: 5000
      });
      
      const isRunning = response.ok;
      this.logger.debug('WAHA connection check result', { isRunning });
      
      return isRunning;
    } catch (error) {
      this.logger.debug('WAHA connection check failed', { error: error.message });
      return false;
    }
  }

  /**
   * Retry initialization with exponential backoff
   * @returns {Promise<object>} Final initialization result
   */
  async retryInitialization() {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        this.logger.info(`Retry attempt ${attempt}/${this.maxRetries}`);
        
        // Wait with exponential backoff
        const delay = this.retryDelay * Math.pow(2, attempt - 1);
        await this.sleep(delay);
        
        // Validate session and webhook
        const validation = await this.sessionInitializer.validateSessionAndWebhook();
        
        if (validation.valid) {
          this.logger.info('Session validation successful on retry', {
            attempt,
            sessionStatus: validation.status,
            webhookConfigured: validation.webhookConfigured
          });
          
          this.initializationComplete = true;
          return {
            success: true,
            containerStarted: this.containerStarted,
            sessionStatus: validation.status,
            webhookConfigured: validation.webhookConfigured,
            sessionInfo: validation.sessionInfo,
            retryAttempt: attempt
          };
        }
        
        this.logger.warning(`Retry ${attempt} failed`, {
          attempt,
          maxRetries: this.maxRetries,
          error: validation.error || 'Validation failed'
        });

        // If the session explicitly reports FAILED, try a targeted restart
        if (
          (validation && validation.status === 'FAILED') ||
          (typeof validation?.error === 'string' && validation.error.includes('FAILED'))
        ) {
          this.logger.warning('Session status FAILED detected during retry; restarting session...', {
            attempt,
            status: validation.status || 'UNKNOWN'
          });
          try {
            // Reuse the session restart logic (also used for 422 handling)
            await this.sessionInitializer.handle422Error();
            this.logger.info('Session restart triggered due to FAILED status', { attempt });
            // Give WAHA a brief moment before the next validation cycle
            await this.sleep(2000);
          } catch (restartError) {
            this.logger.error('Failed to restart session after FAILED status', restartError);
          }
        }
        
      } catch (error) {
        this.logger.warning(`Retry ${attempt} threw error`, {
          attempt,
          maxRetries: this.maxRetries,
          error: error.message
        });
      }
    }
    
    this.logger.error('Session validation failed after all retries');
    throw new Error('Session validation failed after all retries');
  }

  /**
   * Handle 422 errors by restarting the session
   * @param {string} sessionName - Session name to restart
   * @returns {Promise<boolean>} True if restart was successful
   */
  async handle422Error(sessionName = 'default') {
    try {
      this.logger.warning(`Handling 422 error for session ${sessionName}`);
      
      const success = await this.sessionInitializer.handle422Error(sessionName);
      
      if (success) {
        this.logger.info(`Session ${sessionName} restarted successfully`);
        
        // Re-validate after restart
        const validation = await this.sessionInitializer.validateSessionAndWebhook();
        if (validation.valid) {
          this.logger.info('Session validation successful after restart');
          return true;
        } else {
          this.logger.warning('Session validation failed after restart', validation);
          return false;
        }
      }
      
      return false;
    } catch (error) {
      this.logger.error(`Error restarting session ${sessionName}`, error);
      throw error;
    }
  }

  /**
   * Get WAHA URL from environment or default
   * @returns {string} WAHA base URL
   */
  getWahaUrl() {
    return process.env.WAHA_URL || 'http://localhost:3000';
  }

  /**
   * Sleep for specified milliseconds
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get initialization status
   * @returns {object} Current status
   */
  getStatus() {
    return {
      initializationComplete: this.initializationComplete,
      containerStarted: this.containerStarted,
      maxRetries: this.maxRetries,
      retryDelay: this.retryDelay,
      config: {
        wahaUrl: this.getWahaUrl(),
        sessionConfig: this.sessionInitializer.getConfig()
      }
    };
  }

  /**
   * Reset initialization state (for testing or re-initialization)
   */
  reset() {
    this.containerStarted = false;
    this.initializationComplete = false;
    this.logger.info('WAHAInitializer state reset');
  }

  /**
   * Force re-initialization (reset and initialize again)
   * @returns {Promise<object>} Re-initialization result
   */
  async reinitialize() {
    this.logger.info('Force re-initializing WAHA...');
    this.reset();
    return await this.initialize();
  }

  /**
   * Check if initialization is complete
   * @returns {boolean} True if initialization is complete
   */
  isInitialized() {
    return this.initializationComplete;
  }

  /**
   * Get container and session status
   * @returns {Promise<object>} Status information
   */
  async getFullStatus() {
    try {
      const containerStatus = await this.dockerManager.getContainerStatus();
      const sessionValidation = await this.sessionInitializer.validateSessionAndWebhook();
      
      return {
        container: containerStatus,
        session: sessionValidation,
        initialization: this.getStatus()
      };
    } catch (error) {
      this.logger.error('Failed to get full status', error);
      return {
        container: { error: 'Failed to get container status' },
        session: { error: 'Failed to get session status' },
        initialization: this.getStatus()
      };
    }
  }
}

// Export singleton instance for consistency
module.exports = new WAHAInitializer();

// Export class for custom instances
module.exports.WAHAInitializer = WAHAInitializer;
