const httpClient = require('../utils/httpClient');

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
        console.log(`Session '${this.sessionName}' status:`, response.data.status);
        return response.data;
      }
      
      throw new Error('No session data received');
    } catch (error) {
      console.error('Error getting session status:', error.message);
      if (error.response?.status === 404) {
        console.log(`Session '${this.sessionName}' not found`);
        return { status: 'NOT_FOUND' };
      }
      throw error;
    }
  }

  async isAuthenticated() {
    try {
      const sessionData = await this.getSessionStatus();
      const isAuth = sessionData.status === 'WORKING';
      console.log(`Session '${this.sessionName}' authenticated:`, isAuth);
      return isAuth;
    } catch (error) {
      console.error('Error checking authentication:', error.message);
      return false;
    }
  }

  // Session lifecycle management
  async startOrUpdateSession(webhookUrl, events, resetCachesFn, handleSessionCreateErrorFn) {
    try {
      console.log(`Starting/updating session '${this.sessionName}'...`);
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
      
      console.log('Session config:', JSON.stringify(sessionConfig, null, 2));
      
      const response = await httpClient.post(`${this.baseURL}/api/sessions/start`, sessionConfig, {
        timeout: 30000,
        headers: { 'Content-Type': 'application/json' }
      });
      
      console.log('Session start/update response:', response.status, response.data);
      // Fire-and-forget: try to ensure host.docker.internal webhook after start/update
      try { this._ensureHostDockerWebhookWithRetries(3, 10_000); } catch (_) {}
      return response.data;
    } catch (error) {
      console.error('Error in startOrUpdateSession:', error.message);
      return await handleSessionCreateErrorFn(error, webhookUrl, events);
    }
  }

  async handleSessionCreateError(error, webhookUrl, events, startSessionFn, configureWebhookFn) {
    const status = error.response?.status;
    const errorData = error.response?.data;
    
    console.log('Session creation error details:', { status, errorData });
    
    if (status === 422 && errorData?.message?.includes('already exists')) {
      console.log('Session already exists, attempting to configure webhook...');
      try {
        await configureWebhookFn(webhookUrl, events);
        return { status: 'updated', message: 'Session exists, webhook configured' };
      } catch (webhookError) {
        console.error('Webhook configuration failed:', webhookError.message);
        throw new Error(`Session exists but webhook configuration failed: ${webhookError.message}`);
      }
    }
    
    if (status === 409) {
      console.log('Session conflict, trying legacy start method...');
      return await startSessionFn();
    }
    
    throw error;
  }

  async startSession() {
    try {
      console.log(`Starting session '${this.sessionName}' (legacy method)...`);
      
      const response = await httpClient.post(`${this.baseURL}/api/sessions/start`, {
        name: this.sessionName
      }, {
        timeout: 30000,
        headers: { 'Content-Type': 'application/json' }
      });
      
      console.log('Legacy session start response:', response.status, response.data);
      // Fire-and-forget: try to ensure host.docker.internal webhook after start
      try { this._ensureHostDockerWebhookWithRetries(3, 10_000); } catch (_) {}
      return response.data;
    } catch (error) {
      console.error('Error in legacy startSession:', error.message);
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
      console.log('createSessionWithConfig response:', response.status, response.data);
      return response.data;
    } catch (error) {
      const status = error?.response?.status;
      const data = error?.response?.data;
      if (status === 422 && (data?.message || '').toLowerCase().includes('already exists')) {
        console.log(`Session '${this.sessionName}' already exists (createSessionWithConfig)`);
        return { status: 'exists' };
      }
      console.error('Error creating session with config:', error.message);
      throw error;
    }
  }

  async stopSession() {
    try {
      console.log(`Stopping session '${this.sessionName}'...`);
      
      const response = await httpClient.post(`${this.baseURL}/api/sessions/stop`, {
        name: this.sessionName
      }, {
        timeout: 15000,
        headers: { 'Content-Type': 'application/json' }
      });
      
      console.log('Session stop response:', response.status, response.data);
      this._resetCaches();
      return response.data;
    } catch (error) {
      console.error('Error stopping session:', error.message);
      throw error;
    }
  }

  async deleteSession() {
    try {
      console.log(`Deleting session '${this.sessionName}'...`);

      const response = await httpClient.delete(
        `${this.baseURL}/api/sessions/${this.sessionName}`,
        {
          timeout: 20000,
          headers: { 'Accept': 'application/json' }
        }
      );

      console.log('Session delete response:', response.status, response.data);
      this._resetCaches();
      return response.data || { status: 'deleted' };
    } catch (error) {
      if (error.response?.status === 404) {
        console.log(`Session '${this.sessionName}' not found on delete (already removed)`);
        this._resetCaches();
        return { status: 'not_found' };
      }
      console.error('Error deleting session:', error.message);
      throw error;
    }
  }

  async logoutSession() {
    try {
      console.log(`Logging out session '${this.sessionName}'...`);

      const response = await httpClient.post(
        `${this.baseURL}/api/sessions/${this.sessionName}/logout`,
        {},
        {
          timeout: 20000,
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
        }
      );

      console.log('Session logout response:', response.status, response.data);
      this._resetCaches();
      return response.data || { status: 'logged_out' };
    } catch (error) {
      if (error.response?.status === 404) {
        console.log(`Session '${this.sessionName}' not found on logout`);
        this._resetCaches();
        return { status: 'not_found' };
      }
      console.error('Error logging out session:', error.message);
      throw error;
    }
  }

  async ensureSessionStarted(safeEnsureWebhookFn) {
    try {
      const sessionData = await this.getSessionStatus();
      
      if (sessionData.status === 'WORKING') {
        console.log('Session is already working');
        return sessionData;
      }
      
      if (sessionData.status === 'STOPPED' || sessionData.status === 'NOT_FOUND') {
        console.log('Session needs to be started');
        await this.startSession();
        safeEnsureWebhookFn();
      }
      
      return await this.getSessionStatus();
    } catch (error) {
      console.error('Error ensuring session started:', error.message);
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
        console.log(`Session '${sessionName}' already active (${status})`);
        return;
      }
      
      console.log(`Starting session '${sessionName}' (current status: ${status})`);
      await this.startSession();
    } catch (error) {
      if (error.response?.status === 422) {
        console.log(`Session '${sessionName}' already exists`);
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
      console.log(`Max start attempts (${maxAttempts}) reached for '${sessionName}' in context '${context}'`);
      return;
    }
    
    this._startAttempts.set(key, attempts + 1);
    
    try {
      const delay = baseDelay * Math.pow(2, attempts);
      console.log(`Attempt ${attempts + 1}/${maxAttempts} to start session '${sessionName}' (context: ${context}), waiting ${delay}ms...`);
      
      await this._sleep(delay);
      await this.startSession();
      
      console.log(`Session '${sessionName}' started successfully on attempt ${attempts + 1}`);
      this._startAttempts.delete(key);
    } catch (startError) {
      console.log(`Start attempt ${attempts + 1} failed for '${sessionName}':`, startError.message);
      
      if (startError.response?.status === 422) {
        console.log(`Session '${sessionName}' already exists, clearing attempts`);
        this._startAttempts.delete(key);
        return;
      }
      
      if (attempts + 1 >= maxAttempts) {
        console.error(`All start attempts failed for session '${sessionName}' in context '${context}'`);
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
          console.log(`Session start completed with status: ${status}`);
          return status;
        }
        
        if (status === 'FAILED') {
          throw new Error('Session failed to start');
        }
        
        await sleepFn(1000);
      } catch (error) {
        console.log('Error waiting for start completion:', error.message);
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
      console.error('Error getting authenticated session status:', error.message);
      throw error;
    }
  }

  // Cache management
  _resetCaches() {
    this.sessionStatusCache.clear();
    this.sessionInfoCache.clear();
    this._startAttempts.clear();
    console.log('Session caches reset');
  }

  resetCaches() {
    this._resetCaches();
  }

  // Utility methods
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Ensure a webhook pointing to host.docker.internal is configured.
   * Attempts up to maxAttempts with intervalMs between attempts.
   * This is useful when WAHA runs in Docker and the bot runs on host.
   */
  async _ensureHostDockerWebhookWithRetries(maxAttempts = 3, intervalMs = 10_000) {
    const port = process.env.PORT || 3001;
    const webhookUrl = `http://host.docker.internal:${port}/waha-events`;
    const requiredEvents = ['message', 'session.status', 'state.change', 'message.any'];
    const sess = this.sessionName;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Check existing webhooks to avoid duplicates
        const getResp = await httpClient.get(`${this.baseURL}/api/sessions/${sess}/webhooks`, {
          timeout: 7000,
          headers: { 'Accept': 'application/json' }
        });
        const items = Array.isArray(getResp.data) ? getResp.data : (Array.isArray(getResp.data?.webhooks) ? getResp.data.webhooks : []);
        const found = items.find(w => String(w?.url || '').toLowerCase() === webhookUrl.toLowerCase());
        const hasAll = found && Array.isArray(found.events) && requiredEvents.every(e => found.events.includes(e));
        if (hasAll) {
          console.log(`host.docker webhook already present for '${sess}' -> ${webhookUrl}`);
          return;
        }

        // Try to add/ensure the webhook
        try {
          await httpClient.post(`${this.baseURL}/api/sessions/${sess}/webhooks`, {
            url: webhookUrl,
            events: requiredEvents,
            hmac: null,
            retries: { policy: 'constant', delaySeconds: 2, attempts: 3 }
          }, { timeout: 10_000, headers: { 'Content-Type': 'application/json' } });
          console.log(`Configured host.docker webhook for '${sess}' -> ${webhookUrl}`);
          return;
        } catch (postErr) {
          const code = postErr?.response?.status || postErr?.code || postErr.message;
          console.log(`Attempt ${attempt}/${maxAttempts} to configure host.docker webhook failed: ${code}`);
        }
      } catch (err) {
        const code = err?.response?.status || err?.code || err.message;
        console.log(`Attempt ${attempt}/${maxAttempts} pre-check failed: ${code}`);
      }

      if (attempt < maxAttempts) {
        await this._sleep(intervalMs);
      }
    }
    console.warn(`Failed to ensure host.docker webhook after ${maxAttempts} attempts`);
  }

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
