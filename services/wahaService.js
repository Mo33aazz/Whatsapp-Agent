const WAHAWebhookManager = require('./wahaWebhookManager');
const WAHAQRManager = require('./wahaQRManager');
const WAHASessionManager = require('./wahaSessionManager');
const WAHAMessaging = require('./wahaMessaging');
const WAHAConnectionUtils = require('./wahaConnectionUtils');

class WAHAService {
  constructor() {
    this.baseURL = process.env.WAHA_URL || 'http://localhost:3000';
    this.sessionName = process.env.WAHA_SESSION_NAME || 'default';
    
    // Initialize all modules
    this.webhookManager = new WAHAWebhookManager(this.baseURL, this.sessionName);
    this.qrManager = new WAHAQRManager(this.baseURL, this.sessionName);
    this.sessionManager = new WAHASessionManager(this.baseURL, this.sessionName);
    this.messaging = new WAHAMessaging(this.baseURL, this.sessionName);
    this.connectionUtils = new WAHAConnectionUtils(this.baseURL);
    
    // Legacy properties for backward compatibility
    this.lastQRCode = null;
    this.sessionStatus = 'STOPPED';

    // Control flags
    this._logoutLocked = false; // when true, do not auto-start or auto-configure webhooks
    this._autoManageEnabled = true; // general gate for background monitors/ensures
  }

  // Startup bootstrap: ensure the default session exists with the requested config
  async ensureDefaultSessionExists() {
    try {
      // Best effort: check WAHA connectivity with brief retries
      try {
        if (typeof this.connectionUtils.checkConnectionWithRetry === 'function') {
          await this.connectionUtils.checkConnectionWithRetry(2, 1500);
        } else {
          await this.checkConnection();
        }
      } catch (e) {
        console.log('WAHA not reachable yet; proceeding with session check anyway');
      }

      const sessName = this.sessionName || 'default';
      const info = await this.sessionManager.getSessionInfo();
      const status = info?.data?.status || 'UNKNOWN';
      if (status !== 'NOT_FOUND') {
        console.log(`Session '${sessName}' already present (status: ${status})`);
        return { created: false, status };
      }

      // Build the exact config as requested
      const webhookUrl = 'http://host.docker.internal:3001/waha-events';
      const payload = {
        name: sessName,
        start: true,
        config: {
          proxy: null,
          debug: false,
          noweb: {
            store: {
              enabled: true,
              fullSync: false
            }
          },
          webhooks: [
            {
              url: webhookUrl,
              events: [
                'message',
                'session.status',
                'message.any'
              ],
              hmac: null,
              retries: null,
              customHeaders: null
            }
          ]
        }
      };

      console.log(`Creating WAHA session '${sessName}' with startup config...`);
      const result = await this.sessionManager.createSessionWithConfig(payload);
      // Optionally start webhook monitor in background
      try { this._safeStartWebhookMonitor(); } catch (_) {}
      return { created: true, result };
    } catch (error) {
      console.log('Ensure default session failed (non-fatal):', error.message);
      return { created: false, error: error.message };
    }
  }

  // Webhook URL helpers (delegated to webhook manager)
  getEventsWebhookUrl() {
    return this.webhookManager.getEventsWebhookUrl();
  }

  getCandidateWebhookUrls() {
    return this.webhookManager.getCandidateWebhookUrls();
  }

  getRequiredEvents() {
    return this.webhookManager.getRequiredEvents();
  }

  // Core QR code functionality (delegated to QR manager)
  async getQRCode() {
    try {
      if (this._logoutLocked) {
        throw new Error('Session is locked by logout; QR generation disabled');
      }
      const qrCode = await this.qrManager.getQRCodeDirect(
        () => this.qrManager.handleSessionStatus(
          () => this.sessionManager.getSessionInfo(),
          () => this._safeStartWebhookMonitor(),
          (sessionName, context) => this._attemptStartWithBackoffGuarded(sessionName, context)
        ),
        () => this.qrManager.pollForQRCode(
          (lastStatus) => this.qrManager.checkSessionStatus(
            lastStatus,
            () => this.sessionManager.getSessionInfo()
          ),
          (sessionName, context) => this._attemptStartWithBackoffGuarded(sessionName, context),
          (ms) => this._sleep(ms)
        )
      );
      this.lastQRCode = qrCode;
      return qrCode;
    } catch (error) {
      console.error('Error in QR code generation process:', error.message);
      throw error;
    }
  }

  async getQRCodeDirect() {
    return this.getQRCode();
  }

  formatQRCode(qrData) {
    return this.qrManager.formatQRCode(qrData);
  }

  // Session management for QR (delegated to QR manager)
  async startSessionForQR() {
    return this.qrManager.startSessionForQR(
      () => this.sessionManager.resetCaches(),
      (sess) => this._startSessionIfNeededGuarded(sess),
      () => this._safeStartWebhookMonitor(),
      () => this._safeEnsureWebhook()
    );
  }

  // Typing indicators (delegated to messaging)
  async startTyping(chatId) {
    return this.messaging.startTyping(chatId);
  }

  async stopTyping(chatId) {
    return this.messaging.stopTyping(chatId);
  }

  // Legacy QR methods (delegated to QR manager)
  async createSessionAndGetQR() {
    return this.qrManager.createSessionAndGetQR(
      () => this._safeStartWebhookMonitor(),
      () => this.qrManager.waitForSessionReady(
        10,
        () => this.sessionManager.getSessionInfo(),
        (ms) => this._sleep(ms)
      )
    );
  }

  async waitForSessionReady(maxAttempts = 10) {
    return this.qrManager.waitForSessionReady(
      maxAttempts,
      () => this.sessionManager.getSessionInfo(),
      (ms) => this._sleep(ms)
    );
  }

  async startAuthentication() {
    return this.qrManager.startAuthentication();
  }

  async fetchQRCode() {
    return this.qrManager.fetchQRCodeLegacy();
  }

  // Connection checking (delegated to connection utils)
  async checkConnection() {
    return this.connectionUtils.checkConnection();
  }

  // Session status and management (delegated to session manager)
  async getSessionStatus(sessionName) {
    const targetSession = sessionName || this.sessionName;
    const originalSessionName = this.sessionManager.sessionName;
    
    if (targetSession !== originalSessionName) {
      this.sessionManager.sessionName = targetSession;
    }
    
    try {
      const result = await this.sessionManager.getSessionStatus();
      return result;
    } finally {
      this.sessionManager.sessionName = originalSessionName;
    }
  }

  async isAuthenticated(sessionName) {
    const targetSession = sessionName || this.sessionName;
    const originalSessionName = this.sessionManager.sessionName;
    
    if (targetSession !== originalSessionName) {
      this.sessionManager.sessionName = targetSession;
    }
    
    try {
      const result = await this.sessionManager.isAuthenticated();
      return result;
    } finally {
      this.sessionManager.sessionName = originalSessionName;
    }
  }

  // Message sending (delegated to messaging)
  async sendMessage(chatId, text) {
    return this.messaging.sendMessage(chatId, text);
  }

  // Session lifecycle (delegated to session manager with webhook integration)
  async startOrUpdateSession() {
    const webhookUrl = this.getEventsWebhookUrl();
    const events = this.getRequiredEvents();
    
    return this.sessionManager.startOrUpdateSession(
      webhookUrl,
      events,
      () => this.sessionManager.resetCaches(),
      (error, webhookUrl, events) => this.sessionManager.handleSessionCreateError(
        error,
        webhookUrl,
        events,
        () => this.sessionManager.startSession(),
        (url, evts) => this.webhookManager.configureWebhook(url, evts)
      )
    );
  }

  async startSession() {
    if (this._logoutLocked) {
      throw new Error('Session is locked by logout; start disabled');
    }
    return this.sessionManager.startSession();
  }

  async configureWebhook(webhookUrl) {
    const url = webhookUrl || this.getEventsWebhookUrl();
    const events = this.getRequiredEvents();
    return this.webhookManager.configureWebhook(url, events);
  }

  async stopSession() {
    return this.sessionManager.stopSession();
  }

  async deleteSession(sessionName) {
    const targetSession = sessionName || this.sessionName;
    const originalSessionName = this.sessionManager.sessionName;

    if (targetSession !== originalSessionName) {
      this.sessionManager.sessionName = targetSession;
    }

    try {
      const result = await this.sessionManager.deleteSession();
      return result;
    } finally {
      this.sessionManager.sessionName = originalSessionName;
    }
  }

  async logoutSession(sessionName) {
    const targetSession = sessionName || this.sessionName;
    const originalSessionName = this.sessionManager.sessionName;

    if (targetSession !== originalSessionName) {
      this.sessionManager.sessionName = targetSession;
    }

    try {
      const result = await this.sessionManager.logoutSession();
      return result;
    } finally {
      this.sessionManager.sessionName = originalSessionName;
    }
  }

  async ensureSessionStarted() {
    if (this._logoutLocked) return { status: 'LOCKED' };
    return this.sessionManager.ensureSessionStarted(() => this._safeEnsureWebhook());
  }

  // Webhook management (delegated to webhook manager)
  async setupWebhookAfterAuth(sessionName) {
    const targetSession = sessionName || this.sessionName;
    if (this._logoutLocked || !this._autoManageEnabled) return { ensured: false, skipped: true, reason: 'locked' };
    // Ensure webhook configuration once authenticated
    return this.webhookManager.ensureWebhookConfigured(
      targetSession,
      (sess) => this._getSessionInfo(sess),
      (ms) => this._sleep(ms)
    );
  }

  startWebhookAuthMonitor(sessionName) {
    const targetSession = sessionName || this.sessionName;
    if (this._logoutLocked || !this._autoManageEnabled) return;
    return this.webhookManager.startWebhookAuthMonitor(
      targetSession,
      (sess) => this._getSessionInfo(sess),
      (ms) => this._sleep(ms)
    );
  }

  async ensureWebhookConfigured(sessionName) {
    const targetSession = sessionName || this.sessionName;
    if (this._logoutLocked || !this._autoManageEnabled) return { ensured: false, skipped: true, reason: 'locked' };
    return this.webhookManager.ensureWebhookConfigured(
      targetSession,
      (sess) => this._getSessionInfo(sess),
      (ms) => this._sleep(ms),
      (sess, sleepFn) => this.sessionManager.waitForStartCompletion(30000, sleepFn)
    );
  }

  async configureWahaEventsWebhook() {
    return this.webhookManager.configureWahaEventsWebhook();
  }

  // Helper methods that coordinate between modules
  _resetCaches() {
    this.sessionManager.resetCaches();
    if (typeof this.webhookManager.resetWebhookCaches === 'function') {
      this.webhookManager.resetWebhookCaches();
    }
  }

  _safeStartWebhookMonitor() {
    try {
      if (!this._logoutLocked && this._autoManageEnabled) this.startWebhookAuthMonitor(this.sessionName);
    } catch (error) {
      console.log('Safe webhook monitor start failed (non-critical):', error.message);
    }
  }

  _safeEnsureWebhook() {
    try {
      if (this._logoutLocked || !this._autoManageEnabled) return;
      this.ensureWebhookConfigured(this.sessionName).catch(error => {
        console.log('Safe webhook ensure failed (non-critical):', error.message);
      });
    } catch (error) {
      console.log('Safe webhook ensure failed (non-critical):', error.message);
    }
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Additional helper methods for backward compatibility
  async _handleSessionStatus() {
    return this.qrManager.handleSessionStatus(
      () => this.sessionManager.getSessionInfo(),
      () => this._safeStartWebhookMonitor(),
      (sessionName, context) => this.sessionManager.attemptStartWithBackoff(sessionName, context)
    );
  }

  async _pollForQRCode() {
    return this.qrManager.pollForQRCode(
      (lastStatus) => this.qrManager.checkSessionStatus(
        lastStatus,
        () => this.sessionManager.getSessionInfo()
      ),
      (sessionName, context) => this.sessionManager.attemptStartWithBackoff(sessionName, context),
      (ms) => this._sleep(ms)
    );
  }

  async _checkSessionStatus(lastStatus) {
    return this.qrManager.checkSessionStatus(
      lastStatus,
      () => this.sessionManager.getSessionInfo()
    );
  }

  async _fetchQRCode() {
    return this.qrManager.fetchQRCode();
  }

  async _startSessionIfNeeded(sess) {
    return this.sessionManager.startSessionIfNeeded(sess);
  }

  async _startSessionIfNeededGuarded(sess) {
    if (this._logoutLocked) {
      console.log('Start session skipped: session is logout-locked');
      return;
    }
    return this.sessionManager.startSessionIfNeeded(sess);
  }

  async _getSessionStatusSafe() {
    return this.sessionManager.getSessionStatusSafe();
  }

  async _sendTypingRequest(endpoint, chatId) {
    return this.messaging._sendTypingRequest(chatId, endpoint === 'start');
  }

  async _handleSessionCreateError(createError, sessionData) {
    const webhookUrl = this.getEventsWebhookUrl();
    const events = this.getRequiredEvents();
    
    return this.sessionManager.handleSessionCreateError(
      createError,
      webhookUrl,
      events,
      () => this.sessionManager.startSession(),
      (url, evts) => this.webhookManager.configureWebhook(url, evts)
    );
  }

  async _waitForStartCompletion(sess) {
    return this.sessionManager.waitForStartCompletion(30000, (ms) => this._sleep(ms));
  }

  async _getAuthenticatedSessionStatus(sess) {
    return this.sessionManager.getAuthenticatedSessionStatus();
  }

  async _isWebhookCached(sess, candidateUrls, requiredEvents) {
    return this.webhookManager.isWebhookCached(sess, candidateUrls, requiredEvents);
  }

  async _configureViaSessionUpdate(sess, candidateUrls, requiredEvents) {
    return this.webhookManager.configureViaSessionUpdate(sess, candidateUrls, requiredEvents);
  }

  async _configureViaWebhooksEndpoint(sess, candidateUrls, requiredEvents) {
    return this.webhookManager.configureViaWebhooksEndpoint(sess, candidateUrls, requiredEvents);
  }

  async _configureViaConfigEndpoint(sess, webhookUrl, requiredEvents) {
    return this.webhookManager.configureViaConfigEndpoint(sess, webhookUrl, requiredEvents);
  }

  async _verifyWebhookConfig(sess, candidateUrls) {
    return this.webhookManager.verifyWebhookConfig(sess, candidateUrls);
  }

  async _verifyWebhookViaEndpoint(sess, candidateUrls) {
    return this.webhookManager.verifyWebhookViaEndpoint(sess, candidateUrls);
  }

  async _attemptStartWithBackoff(sessionName, reason) {
    return this.sessionManager.attemptStartWithBackoff(sessionName, reason);
  }

  async _attemptStartWithBackoffGuarded(sessionName, reason) {
    if (this._logoutLocked) {
      console.log(`Attempt start skipped (${reason}): session is logout-locked`);
      return;
    }
    return this.sessionManager.attemptStartWithBackoff(sessionName, reason);
  }

  async _getSessionInfo(sessionName) {
    const targetSession = sessionName || this.sessionName;
    const originalSessionName = this.sessionManager.sessionName;
    
    if (targetSession !== originalSessionName) {
      this.sessionManager.sessionName = targetSession;
    }
    
    try {
      const result = await this.sessionManager.getSessionInfo();
      return result;
    } finally {
      this.sessionManager.sessionName = originalSessionName;
    }
  }

  // Logout lock controls
  async stopAndLockSession(wait = true) {
    this._logoutLocked = true;
    this._autoManageEnabled = false;
    try { this.webhookManager.resetWebhookCaches(); } catch (_) {}
    try {
      const result = await this.sessionManager.stopSession();
      if (wait) {
        const start = Date.now();
        const timeoutMs = 15000;
        while (Date.now() - start < timeoutMs) {
          try {
            const info = await this.sessionManager.getSessionInfo();
            const status = info?.data?.status;
            if (status === 'STOPPED' || status === 'NOT_FOUND') break;
          } catch (_) {}
          await this._sleep(500);
        }
      }
      return result;
    } catch (e) {
      // Keep locked even if stop failed, to prevent auto restart
      throw e;
    }
  }

  isLogoutLocked() { return this._logoutLocked; }
  unlockLogout() { this._logoutLocked = false; this._autoManageEnabled = true; }
}

module.exports = new WAHAService();
