const WAHAQRManager = require('./wahaQRManager');
const WAHASessionManager = require('./wahaSessionManager');
const WAHAMessaging = require('./wahaMessaging');
const WAHAConnectionUtils = require('./wahaConnectionUtils');
const logger = require('../utils/logger');

class WAHAService {
  constructor() {
    this.baseURL = process.env.WAHA_URL || 'http://localhost:3000';
    this.sessionName = process.env.WAHA_SESSION_NAME || 'default';
    
    // Initialize all modules
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
      const sessName = this.sessionName || 'default';
      // Always recreate default session on startup – no webhook configuration
      try { await this.sessionManager.deleteSession(); } catch (_) {}
      const payload = { name: sessName, start: true };
      logger.info('WAHA', `Creating WAHA session '${sessName}'...`);
      const result = await this.sessionManager.createSessionWithConfig(payload);
      return { created: true, result };
    } catch (error) {
      logger.warn('WAHA', 'Ensure default session failed (non-fatal)', { error: error.message });
      return { created: false, error: error.message };
    }
  }

  // Startup bootstrap (webhook-aware): create default session with configured webhook if missing
  async ensureDefaultSessionExistsWithWebhook() {
    try {
      const sessName = this.sessionName || 'default';
      const current = await this.sessionManager.getSessionStatus();
      const webhookUrl = this.getEventsWebhookUrl();

      if (current && current.status && current.status !== 'NOT_FOUND') {
        // Ensure webhook present for existing session
        const ensured = await this._ensureWebhook(sessName, webhookUrl, this.getRequiredEvents());
        return { created: false, status: current.status, webhookEnsured: ensured };
      }

      // Create session minimal, then ensure webhook via dedicated endpoint
      const payload = { name: sessName, start: true };
      logger.info('Session', `Creating WAHA session '${sessName}'...`);
      const result = await this.sessionManager.createSessionWithConfig(payload);
      await this._ensureWebhook(sessName, webhookUrl, this.getRequiredEvents());
      return { created: true, result };
    } catch (error) {
      logger.warn('Session', 'Ensure default session (webhook-aware) failed', { error: error.message });
      return { created: false, error: error.message };
    }
  }

  // Webhook URL helpers (no-op/simple helpers)
  getEventsWebhookUrl() {
    const path = (process.env.WEBHOOK_PATH || '/waha-events');
    const base = process.env.PUBLIC_BASE_URL;
    if (base) return `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : '/' + path}`;
    const port = process.env.PORT || 3001;
    return `http://host.docker.internal:${port}${path.startsWith('/') ? path : '/' + path}`;
  }

  getCandidateWebhookUrls() {
    return [this.getEventsWebhookUrl()];
  }

  getRequiredEvents() {
    return ['message', 'session.status', 'state.change', 'message.any'];
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
      logger.error('Error in QR code generation process', 'QR', { error: error.message });
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

  // Removed legacy fetchQRCode; QR retrieval is handled by getQRCode()

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
    // Simplified: just start session without webhook configuration
    return this.sessionManager.startSession();
  }

  async startSession() {
    if (this._logoutLocked) {
      throw new Error('Session is locked by logout; start disabled');
    }
    return this.sessionManager.startSession();
  }

  async configureWebhook() { return { skipped: true }; }

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

  async restartSession(sessionName) {
    const targetSession = sessionName || this.sessionName;
    const originalSessionName = this.sessionManager.sessionName;

    if (targetSession !== originalSessionName) {
      this.sessionManager.sessionName = targetSession;
    }

    try {
      const result = await this.sessionManager.restartSession();
      return result;
    } finally {
      this.sessionManager.sessionName = originalSessionName;
    }
  }

  async ensureSessionStarted() {
    if (this._logoutLocked) return { status: 'LOCKED' };
    return this.sessionManager.ensureSessionStarted(() => {});
  }

  // Webhook management disabled (no-op)
  async setupWebhookAfterAuth() { return { ensured: false, skipped: true }; }

  startWebhookAuthMonitor() { /* disabled */ }

  async ensureWebhookConfigured() { return { ensured: false, skipped: true }; }

  async configureWahaEventsWebhook() { return { ensured: false, skipped: true }; }

  // Helper methods that coordinate between modules
  _resetCaches() {
    this.sessionManager.resetCaches();
  }

  _safeStartWebhookMonitor() {
    // disabled
  }

  _safeEnsureWebhook() {
    // disabled
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Webhook ensure helpers (explicitly configure via WAHA API)
  async _getWebhooks(sessionName) {
    try {
      const httpClient = require('../utils/httpClient');
      const resp = await httpClient.get(`${this.baseURL}/api/sessions/${sessionName}/webhooks`, {
        timeout: 8000,
        headers: { 'Accept': 'application/json' }
      });
      return Array.isArray(resp.data) ? resp.data : [];
    } catch (e) {
      if (e?.response?.status === 404) {
        // Endpoint unsupported on this WAHA version
        return null;
      }
      return [];
    }
  }

  async _addWebhook(sessionName, url, events) {
    const httpClient = require('../utils/httpClient');
    await httpClient.post(`${this.baseURL}/api/sessions/${sessionName}/webhooks`, {
      url,
      events,
      hmac: null,
      retries: null,
      customHeaders: null
    }, {
      timeout: 15000,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async _ensureWebhook(sessionName, url, events) {
    const webhooks = await this._getWebhooks(sessionName);
    if (webhooks === null) {
      // Endpoint not available; skip silently
      return { ensured: false, skipped: true };
    }
    const has = webhooks.some(w => w && w.url === url);
    if (has) return { ensured: true, updated: false };
    try {
      await this._addWebhook(sessionName, url, events);
      return { ensured: true, updated: true };
    } catch (e) {
      logger.warn('Webhook', 'Failed to add webhook', { error: e.message });
      return { ensured: false, error: e.message };
    }
  }

  // Additional helper methods (guarded start only)
  async _startSessionIfNeededGuarded(sess) {
    if (this._logoutLocked) {
      logger.info('Session', 'Start session skipped: session is logout-locked');
      return;
    }
    return this.sessionManager.startSessionIfNeeded(sess);
  }

  async _attemptStartWithBackoffGuarded(sessionName, reason) {
    if (this._logoutLocked) {
      logger.info('Session', `Attempt start skipped (${reason}): session is logout-locked`);
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
