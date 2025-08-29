const httpClient = require('../utils/httpClient');
const logger = require('../utils/logger');

class WAHASessionManager {
  constructor(baseURL, sessionName) {
    this.baseURL = baseURL;
    this.sessionName = sessionName;
    this.sessionStatusCache = new Map();
    this.sessionInfoCache = new Map();
    this._startAttempts = new Map();
  }

  // Core session operations
  async getSessionStatus() {
    try {
      const response = await httpClient.get(`${this.baseURL}/api/sessions/${this.sessionName}`, {
        timeout: 10000,
        headers: { 'Accept': 'application/json' }
      });
      
      if (response?.data) {
        logger.info('Session', `Session '${this.sessionName}' status`, { status: response.data.status });
        return response.data;
      }
      
      throw new Error('No session data received');
    } catch (error) {
      logger.error('Error getting session status', 'Session', { error: error.message });
      if (error.response?.status === 404) {
        logger.info('Session', `Session '${this.sessionName}' not found`);
        return { status: 'NOT_FOUND' };
      }
      throw error;
    }
  }

  async isAuthenticated() {
    try {
      const sessionData = await this.getSessionStatus();
      const isAuth = sessionData.status === 'WORKING';
      logger.info('Session', `Session '${this.sessionName}' authenticated`, { authenticated: isAuth });
      return isAuth;
    } catch (error) {
      logger.error('Error checking authentication', 'Session', { error: error.message });
      return false;
    }
  }

  // Session lifecycle management
  async startOrUpdateSession(webhookUrl, events, resetCachesFn, handleSessionCreateErrorFn) {
    try {
      logger.info('Session', `Starting/updating session '${this.sessionName}'...`);
      resetCachesFn();
      
      const sessionConfig = {
        name: this.sessionName,
        config: {
          webhooks: [{
            url: webhookUrl,
            events: events,
            hmac: null,
            retries: 2,
            customHeaders: []
          }]
        }
      };
      
      logger.debug('Session', 'Session config', { config: sessionConfig });
      
      const response = await httpClient.post(`${this.baseURL}/api/sessions/start`, sessionConfig, {
        timeout: 30000,
        headers: { 'Content-Type': 'application/json' }
      });
      
      logger.info('Session', 'Session start/update response', { status: response.status, data: response.data });
      return response.data;
    } catch (error) {
      logger.error('Error in startOrUpdateSession', 'Session', { error: error.message });
      return await handleSessionCreateErrorFn(error, webhookUrl, events);
    }
  }

  async handleSessionCreateError(error, webhookUrl, events, startSessionFn, configureWebhookFn) {
    const status = error.response?.status;
    const errorData = error.response?.data;
    
    logger.warn('Session', 'Session creation error details', { status, errorData });
    
    if (status === 422 && errorData?.message?.includes('already exists')) {
      logger.info('Session', 'Session already exists, attempting to configure webhook...');
      try {
        await configureWebhookFn(webhookUrl, events);
        return { status: 'updated', message: 'Session exists, webhook configured' };
      } catch (webhookError) {
        logger.error('Webhook configuration failed', 'Webhook', { error: webhookError.message });
        throw new Error(`Session exists but webhook configuration failed: ${webhookError.message}`);
      }
    }
    
    if (status === 409) {
      logger.info('Session', 'Session conflict, trying legacy start method...');
      return await startSessionFn();
    }
    
    throw error;
  }

  async startSession() {
    try {
      logger.info('Session', `Starting session '${this.sessionName}' (legacy method)...`);
      
      const response = await httpClient.post(`${this.baseURL}/api/sessions/start`, {
        name: this.sessionName
      }, {
        timeout: 30000,
        headers: { 'Content-Type': 'application/json' }
      });
      
      logger.info('Session', 'Legacy session start response', { status: response.status, data: response.data });
      return response.data;
    } catch (error) {
      logger.error('Error in legacy startSession', 'Session', { error: error.message });
      throw error;
    }
  }

  /**
   * Create a session with a raw WAHA config payload.
   * Intended for precise startup bootstrap where specific fields are required.
   */
  async createSessionWithConfig(payload) {
    try {
      const body = payload || { name: this.sessionName };
      const response = await httpClient.post(
        `${this.baseURL}/api/sessions/start`,
        body,
        {
          timeout: 30000,
          headers: { 'Content-Type': 'application/json' }
        }
      );
      logger.info('Session', 'createSessionWithConfig response', { status: response.status, data: response.data });
      return response.data;
    } catch (error) {
      const status = error?.response?.status;
      const data = error?.response?.data;
      if (status === 422 && (data?.message || '').toLowerCase().includes('already exists')) {
        logger.info('Session', `Session '${this.sessionName}' already exists (createSessionWithConfig)`);
        return { status: 'exists' };
      }
      logger.error('Error creating session with config', 'Session', { error: error.message });
      throw error;
    }
  }

  async stopSession() {
    try {
      logger.info('Session', `Stopping session '${this.sessionName}'...`);
      
      const response = await httpClient.post(`${this.baseURL}/api/sessions/stop`, {
        name: this.sessionName
      }, {
        timeout: 15000,
        headers: { 'Content-Type': 'application/json' }
      });
      
      logger.info('Session', 'Session stop response', { status: response.status, data: response.data });
      this._resetCaches();
      return response.data;
    } catch (error) {
      logger.error('Error stopping session', 'Session', { error: error.message });
      throw error;
    }
  }

  async deleteSession() {
    try {
      logger.info('Session', `Deleting session '${this.sessionName}'...`);

      const response = await httpClient.delete(
        `${this.baseURL}/api/sessions/${this.sessionName}`,
        {
          timeout: 20000,
          headers: { 'Accept': 'application/json' }
        }
      );

      logger.info('Session', 'Session delete response', { status: response.status, data: response.data });
      this._resetCaches();
      return response.data || { status: 'deleted' };
    } catch (error) {
      if (error.response?.status === 404) {
        logger.info('Session', `Session '${this.sessionName}' not found on delete (already removed)`);
        this._resetCaches();
        return { status: 'not_found' };
      }
      logger.error('Error deleting session', 'Session', { error: error.message });
      throw error;
    }
  }

  async logoutSession() {
    try {
      logger.info('Session', `Logging out session '${this.sessionName}'...`);

      const response = await httpClient.post(
        `${this.baseURL}/api/sessions/${this.sessionName}/logout`,
        {},
        {
          timeout: 20000,
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
        }
      );

      logger.info('Session', 'Session logout response', { status: response.status, data: response.data });
      this._resetCaches();
      return response.data || { status: 'logged_out' };
    } catch (error) {
      if (error.response?.status === 404) {
        logger.info('Session', `Session '${this.sessionName}' not found on logout`);
        this._resetCaches();
        return { status: 'not_found' };
      }
      logger.error('Error logging out session', 'Session', { error: error.message });
      throw error;
    }
  }

  async ensureSessionStarted(safeEnsureWebhookFn) {
    try {
      const sessionData = await this.getSessionStatus();
      
      if (sessionData.status === 'WORKING') {
        logger.debug('Session', 'Session is already working');
        return sessionData;
      }
      
      if (sessionData.status === 'STOPPED' || sessionData.status === 'NOT_FOUND') {
        logger.info('Session', 'Session needs to be started');
        await this.startSession();
        safeEnsureWebhookFn();
      }
      
      return await this.getSessionStatus();
    } catch (error) {
      logger.error('Error ensuring session started', 'Session', { error: error.message });
      throw error;
    }
  }

  // Session status and info helpers
  async getSessionStatusSafe() {
    try {
      const info = await this.getSessionInfo();
      return info?.data?.status || 'UNKNOWN';
    } catch (_) {
      return 'UNKNOWN';
    }
  }

  async getSessionInfo() {
    const cacheKey = this.sessionName;
    const cached = this.sessionInfoCache.get(cacheKey);
    const now = Date.now();
    
    if (cached && (now - cached.timestamp) < 2000) {
      return cached.data;
    }
    
    try {
      const response = await httpClient.get(`${this.baseURL}/api/sessions/${this.sessionName}`, {
        timeout: 8000,
        headers: { 'Accept': 'application/json' }
      });
      
      this.sessionInfoCache.set(cacheKey, {
        data: response,
        timestamp: now
      });
      
      return response;
    } catch (error) {
      if (error.response?.status === 404) {
        const notFoundResponse = { data: { status: 'NOT_FOUND' } };
        this.sessionInfoCache.set(cacheKey, {
          data: notFoundResponse,
          timestamp: now
        });
        return notFoundResponse;
      }
      throw error;
    }
  }

  async startSessionIfNeeded(sessionName) {
    try {
      const info = await this.getSessionInfo();
      const status = info?.data?.status;
      
      if (status === 'WORKING' || status === 'SCAN_QR_CODE') {
        logger.debug('Session', `Session '${sessionName}' already active (${status})`);
        return;
      }
      
      logger.info('Session', `Starting session '${sessionName}' (current status: ${status})`);
      await this.startSession();
    } catch (error) {
      if (error.response?.status === 422) {
        logger.debug('Session', `Session '${sessionName}' already exists`);
        return;
      }
      throw error;
    }
  }

  // Backoff and retry logic
  async attemptStartWithBackoff(sessionName, context = 'unknown') {
    const key = `${sessionName}-${context}`;
    const attempts = this._startAttempts.get(key) || 0;
    const maxAttempts = 3;
    const baseDelay = 1000;
    
    if (attempts >= maxAttempts) {
      logger.warn('Session', `Max start attempts (${maxAttempts}) reached for '${sessionName}' in context '${context}'`);
      return;
    }
    
    this._startAttempts.set(key, attempts + 1);
    
    try {
      const delay = baseDelay * Math.pow(2, attempts);
      logger.info('Session', `Attempt ${attempts + 1}/${maxAttempts} to start session '${sessionName}' (context: ${context}), waiting ${delay}ms...`);
      
      await this._sleep(delay);
      await this.startSession();
      
      logger.info('Session', `Session '${sessionName}' started successfully on attempt ${attempts + 1}`);
      this._startAttempts.delete(key);
    } catch (startError) {
      logger.warn('Session', `Start attempt ${attempts + 1} failed for '${sessionName}'`, { error: startError.message });
      
      if (startError.response?.status === 422) {
        logger.debug('Session', `Session '${sessionName}' already exists, clearing attempts`);
        this._startAttempts.delete(key);
        return;
      }
      
      if (attempts + 1 >= maxAttempts) {
        logger.error(`All start attempts failed for session '${sessionName}' in context '${context}'`, 'Session', { sessionName, context });
        this._startAttempts.delete(key);
      }
    }
  }

  // Authentication monitoring
  async waitForStartCompletion(maxWaitMs = 30000, sleepFn) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitMs) {
      try {
        const info = await this.getSessionInfo();
        const status = info?.data?.status;
        
        if (status === 'WORKING' || status === 'SCAN_QR_CODE') {
          logger.info('Session', `Session start completed with status: ${status}`);
          return status;
        }
        
        if (status === 'FAILED') {
          throw new Error('Session failed to start');
        }
        
        await sleepFn(1000);
      } catch (error) {
        logger.warn('Session', 'Error waiting for start completion', { error: error.message });
        await sleepFn(1000);
      }
    }
    
    throw new Error('Session start completion timeout');
  }

  async getAuthenticatedSessionStatus() {
    try {
      const info = await this.getSessionInfo();
      const status = info?.data?.status;
      
      if (status !== 'WORKING') {
        throw new Error(`Session not authenticated, status: ${status}`);
      }
      
      return info.data;
    } catch (error) {
      logger.error('Error getting authenticated session status', 'Session', { error: error.message });
      throw error;
    }
  }

  // Cache management
  _resetCaches() {
    this.sessionStatusCache.clear();
    this.sessionInfoCache.clear();
    this._startAttempts.clear();
    logger.debug('Session', 'Session caches reset');
  }

  resetCaches() {
    this._resetCaches();
  }

  // Utility methods
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // host.docker webhook ensure removed; webhook configuration is centralized in WAHAWebhookManager

  // Getters for cache inspection
  getStartAttempts(sessionName, context) {
    const key = `${sessionName}-${context}`;
    return this._startAttempts.get(key) || 0;
  }

  clearStartAttempts(sessionName, context) {
    const key = `${sessionName}-${context}`;
    this._startAttempts.delete(key);
  }

  // Session validation
  async validateSession() {
    try {
      const sessionData = await this.getSessionStatus();
      return {
        exists: sessionData.status !== 'NOT_FOUND',
        status: sessionData.status,
        authenticated: sessionData.status === 'WORKING',
        data: sessionData
      };
    } catch (error) {
      return {
        exists: false,
        status: 'ERROR',
        authenticated: false,
        error: error.message
      };
    }
  }
}

module.exports = WAHASessionManager;
