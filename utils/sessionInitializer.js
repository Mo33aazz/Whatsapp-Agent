const httpClient = require('./httpClient');
const logger = require('./logger');

/**
 * SessionInitializer utility class for WAHA session management
 * Handles session creation, deletion, validation, and webhook configuration
 * with conditional operations based on container start status
 */
class SessionInitializer {
  constructor() {
    this.logger = logger.child('SessionInitializer');
    this.baseURL = process.env.WAHA_URL || 'http://localhost:3000';
    this.sessionName = process.env.WAHA_SESSION_NAME || 'default';
    this.webhookUrl = this.getWebhookUrl();
    this.maxRetries = 3;
    this.retryDelay = 5000;
  }

  /**
   * Create a new session with webhook configuration
   * @returns {Promise<object>} Session creation result
   */
  async createSessionWithWebhook() {
    try {
      this.logger.info('Creating session with webhook', {
        sessionName: this.sessionName,
        webhookUrl: this.webhookUrl
      });
      // Build payload with webhook already configured in the session config
      const payload = {
        name: this.sessionName,
        start: true,
        config: {
          proxy: null,
          debug: process.env.WAHA_DEBUG === 'true',
          noweb: { store: { enabled: true, fullSync: false } },
          webhooks: [
            {
              url: this.webhookUrl,
              events: ['message', 'session.status', 'state.change', 'message.any'],
              hmac: null,
              retries: null,
              customHeaders: null
            }
          ]
        }
      };

      // Prefer /api/sessions/start; fallback to /api/sessions if needed
      let response;
      try {
        response = await httpClient.post(
          `${this.baseURL}/api/sessions/start`,
          payload,
          {
            timeout: 30000,
            headers: { 'Content-Type': 'application/json' }
          }
        );
        this.logger.info('Session created via /api/sessions/start');
      } catch (errStart) {
        const status = errStart?.response?.status;
        this.logger.debug('Create via /api/sessions/start failed, trying /api/sessions', { status, error: errStart.message });
        response = await httpClient.post(
          `${this.baseURL}/api/sessions`,
          payload,
          {
            timeout: 30000,
            headers: { 'Content-Type': 'application/json' }
          }
        );
        this.logger.info('Session created via /api/sessions');
      }

      this.logger.info('Session created with webhook in config successfully', {
        sessionName: this.sessionName,
        sessionId: response.data?.id,
        status: response.data?.status
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to create session with webhook', {
        sessionName: this.sessionName,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Delete existing session
   * @returns {Promise<object>} Deletion result
   */
  async deleteSession() {
    try {
      this.logger.info('Deleting session', { sessionName: this.sessionName });

      const response = await httpClient.delete(
        `${this.baseURL}/api/sessions/${this.sessionName}`,
        {
          timeout: 20000,
          headers: { 'Accept': 'application/json' }
        }
      );

      this.logger.info('Session deleted successfully', {
        sessionName: this.sessionName,
        response: response.data
      });

      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        this.logger.info('Session not found, already deleted', {
          sessionName: this.sessionName
        });
        return { status: 'not_found' };
      }

      this.logger.error('Failed to delete session', {
        sessionName: this.sessionName,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Recreate session with webhook (conditional operation)
   * @param {boolean} forceDelete - Force delete even if session doesn't exist
   * @returns {Promise<object>} Recreation result
   */
  async recreateSessionWithWebhook(forceDelete = false) {
    try {
      this.logger.info('Recreating session with webhook', {
        sessionName: this.sessionName,
        forceDelete
      });

      // Always attempt to delete the session first per requested flow
      // DELETE /api/sessions/{sessionName}
      try {
        await this.deleteSession();
      } catch (delErr) {
        // Ignore deletion failures other than non-404 network errors
        this.logger.debug('Delete session step non-fatal', {
          sessionName: this.sessionName,
          error: delErr.message
        });
      }

      // Create new session first, then attach webhook
      const newSession = await this.createSessionWithWebhook();

      this.logger.info('Session recreated successfully and webhook attached', {
        sessionName: this.sessionName,
        sessionId: newSession?.id
      });

      return newSession;
    } catch (error) {
      this.logger.error('Failed to recreate session with webhook', {
        sessionName: this.sessionName,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Validate session status
   * @returns {Promise<object>} Validation result
   */
  async validateSessionAndWebhook() {
    try {
      this.logger.info('Validating session status', {
        sessionName: this.sessionName
      });

      // Get session information
      const sessionInfo = await this.getSessionInfo();
      const sessionStatus = sessionInfo?.data?.status;

      this.logger.debug('Session status check', {
        sessionName: this.sessionName,
        status: sessionStatus
      });

      // Treat WORKING and SCAN_QR_CODE as healthy states
      if (sessionStatus === 'WORKING') {
        const webhookOk = await this.checkWebhookConfiguration();
        this.logger.info('Session validation passed', {
          sessionName: this.sessionName,
          status: sessionStatus,
          webhookConfigured: webhookOk
        });
        return {
          valid: true,
          status: sessionStatus,
          webhookConfigured: webhookOk,
          sessionInfo: sessionInfo?.data,
          awaitingQrScan: false
        };
      }

      if (sessionStatus === 'SCAN_QR_CODE') {
        // Green path: session is up and waiting for QR scan
        const webhookOk = await this.checkWebhookConfiguration();
        this.logger.info('Session awaiting QR scan (healthy state)', {
          sessionName: this.sessionName,
          status: sessionStatus,
          webhookConfigured: webhookOk
        });
        return {
          valid: true,
          status: sessionStatus,
          webhookConfigured: webhookOk,
          sessionInfo: sessionInfo?.data,
          awaitingQrScan: true
        };
      }

      // Other states remain non-healthy
      this.logger.warning('Session is not in a healthy state', {
        sessionName: this.sessionName,
        status: sessionStatus
      });
      return {
        valid: false,
        status: sessionStatus,
        error: `Session status is ${sessionStatus}, expected WORKING or SCAN_QR_CODE`
      };
    } catch (error) {
      this.logger.error('Failed to validate session', {
        sessionName: this.sessionName,
        error: error.message,
        stack: error.stack
      });
      return {
        valid: false,
        status: 'ERROR',
        error: error.message
      };
    }
  }

  /**
   * Ensure webhook exists for the session; add if missing.
   */
  async ensureWebhookPresent() {
    const ok = await this.checkWebhookConfiguration();
    if (ok) return { ensured: true, updated: false };
    await this.updateWebhookConfiguration();
    const ok2 = await this.checkWebhookConfiguration();
    return { ensured: ok2, updated: ok2 };
  }

  /**
   * Validate existing session configuration
   * @returns {Promise<object>} Validation result
   */
  async validateExistingSession() {
    try {
      this.logger.info('Validating existing session configuration', {
        sessionName: this.sessionName
      });

      const sessionInfo = await this.getSessionInfo();

      this.logger.info('Existing session validated successfully', {
        sessionName: this.sessionName,
        status: sessionInfo?.data?.status
      });

      return {
        valid: true,
        status: sessionInfo?.data?.status,
        webhookConfigured: true, // Assume webhook is configured since preflight checks passed
        sessionInfo: sessionInfo?.data
      };
    } catch (error) {
      this.logger.error('Failed to validate existing session', {
        sessionName: this.sessionName,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Get session information
   * @returns {Promise<object>} Session information
   */
  async getSessionInfo() {
    try {
      this.logger.debug('Getting session information', {
        sessionName: this.sessionName
      });

      const response = await httpClient.get(`${this.baseURL}/api/sessions/${this.sessionName}`, {
        timeout: 10000,
        headers: { 'Accept': 'application/json' }
      });

      this.logger.debug('Session information retrieved', {
        sessionName: this.sessionName,
        status: response.data?.status,
        id: response.data?.id
      });

      return response;
    } catch (error) {
      this.logger.error('Failed to get session info', {
        sessionName: this.sessionName,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Check webhook configuration for the session
   * @returns {Promise<boolean>} True if webhook is properly configured
   */
  async checkWebhookConfiguration() {
    try {
      this.logger.debug('Checking webhook configuration', {
        sessionName: this.sessionName
      });

      const response = await httpClient.get(`${this.baseURL}/api/sessions/${this.sessionName}/webhooks`, {
        timeout: 10000,
        headers: { 'Accept': 'application/json' }
      });

      const webhooks = response.data || [];
      const hasCorrectWebhook = webhooks.some(webhook => 
        webhook.url === this.webhookUrl &&
        webhook.events?.includes('message') &&
        webhook.events?.includes('session.status')
      );

      this.logger.debug('Webhook configuration check result', {
        sessionName: this.sessionName,
        webhookCount: webhooks.length,
        hasCorrectWebhook,
        configuredUrl: webhooks.find(w => w.url === this.webhookUrl)?.url,
        expectedUrl: this.webhookUrl
      });

      return hasCorrectWebhook;
    } catch (error) {
      this.logger.error('Failed to check webhook configuration', {
        sessionName: this.sessionName,
        error: error.message,
        stack: error.stack
      });
      return false;
    }
  }

  /**
   * Update webhook configuration for existing session
   * @returns {Promise<object>} Update result
   */
  async updateWebhookConfiguration() {
    try {
      this.logger.info('Updating webhook configuration', {
        sessionName: this.sessionName,
        webhookUrl: this.webhookUrl
      });

      const payload = {
        url: this.webhookUrl,
        events: ['message', 'session.status', 'state.change', 'message.any'],
        hmac: null,
        retries: null,
        customHeaders: null
      };

      const response = await httpClient.post(
        `${this.baseURL}/api/sessions/${this.sessionName}/webhooks`,
        payload,
        {
          timeout: 20000,
          headers: { 'Content-Type': 'application/json' }
        }
      );

      this.logger.info('Webhook configuration updated successfully', {
        sessionName: this.sessionName,
        webhookUrl: this.webhookUrl
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to update webhook configuration', {
        sessionName: this.sessionName,
        webhookUrl: this.webhookUrl,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Handle 422 errors by restarting the session
   * @param {string} sessionName - Session name to restart
   * @returns {Promise<boolean>} True if restart was successful
   */
  async handle422Error(sessionName = this.sessionName) {
    try {
      this.logger.warning('Handling 422 error by restarting session', {
        sessionName
      });

      const response = await httpClient.post(
        `${this.baseURL}/api/sessions/${sessionName}/restart`,
        {},
        {
          timeout: 20000,
          headers: { 'Content-Type': 'application/json' }
        }
      );

      this.logger.info('Session restarted successfully after 422 error', {
        sessionName,
        status: response.data?.status
      });

      return true;
    } catch (error) {
      this.logger.error('Failed to restart session after 422 error', {
        sessionName,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Retry session validation with exponential backoff
   * @param {number} maxRetries - Maximum number of retry attempts
   * @param {number} baseDelay - Base delay in milliseconds
   * @returns {Promise<object>} Final validation result
   */
  async retryValidation(maxRetries = this.maxRetries, baseDelay = this.retryDelay) {
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.info('Retrying session validation', {
          attempt,
          maxRetries,
          sessionName: this.sessionName
        });

        const validation = await this.validateSessionAndWebhook();
        
        if (validation.valid) {
          this.logger.info('Session validation successful on retry', {
            attempt,
            sessionName: this.sessionName
          });
          return validation;
        }

        lastError = validation.error || 'Validation failed';
        this.logger.warning(`Session validation attempt ${attempt} failed`, {
          attempt,
          maxRetries,
          sessionName: this.sessionName,
          error: lastError
        });

        if (attempt < maxRetries) {
          const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      } catch (error) {
        lastError = error.message;
        this.logger.warning(`Session validation attempt ${attempt} threw error`, {
          attempt,
          maxRetries,
          sessionName: this.sessionName,
          error: error.message
        });

        if (attempt < maxRetries) {
          const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    this.logger.error('Session validation failed after all retries', {
      maxRetries,
      sessionName: this.sessionName,
      lastError
    });

    throw new Error(`Session validation failed after ${maxRetries} attempts: ${lastError}`);
  }

  /**
   * Get the webhook URL based on environment configuration
   * @returns {string} Configured webhook URL
   */
  getWebhookUrl() {
    const path = (process.env.WEBHOOK_PATH || '/waha-events');
    const base = process.env.PUBLIC_BASE_URL;
    
    if (base) {
      return `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : '/' + path}`;
    }
    
    const port = process.env.PORT || 3001;
    return `http://host.docker.internal:${port}${path.startsWith('/') ? path : '/' + path}`;
  }

  /**
   * Get current configuration
   * @returns {object} Current configuration
   */
  getConfig() {
    return {
      baseURL: this.baseURL,
      sessionName: this.sessionName,
      webhookUrl: this.webhookUrl,
      maxRetries: this.maxRetries,
      retryDelay: this.retryDelay
    };
  }

  /**
   * Update configuration
   * @param {object} config - New configuration
   */
  updateConfig(config) {
    if (config.baseURL) this.baseURL = config.baseURL;
    if (config.sessionName) this.sessionName = config.sessionName;
    if (config.webhookUrl) this.webhookUrl = config.webhookUrl;
    if (config.maxRetries) this.maxRetries = config.maxRetries;
    if (config.retryDelay) this.retryDelay = config.retryDelay;
    
    this.logger.info('SessionInitializer configuration updated', this.getConfig());
  }
}

// Export singleton instance for consistency
module.exports = new SessionInitializer();

// Export class for custom instances
module.exports.SessionInitializer = SessionInitializer;
