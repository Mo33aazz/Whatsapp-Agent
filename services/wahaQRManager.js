const httpClient = require('../utils/httpClient');
const logger = require('../utils/logger');

class WAHAQRManager {
  constructor(baseURL, sessionName) {
    this.baseURL = baseURL;
    this.sessionName = sessionName;
    this.lastQRCode = null;
    this._qrStartInProgress = new Map();
  }

  // Core QR code functionality
  async getQRCode() {
    try {
      logger.info('QR', 'Starting QR code generation process...');
      const result = await this.getQRCodeDirect();
      
      // If result indicates already connected, return it as success
      if (result && result.success) {
        logger.info('QR', 'WhatsApp connection status returned', result);
        return result;
      }
      
      logger.info('QR', 'QR code generated successfully');
      return result;
    } catch (error) {
      logger.error('Error in QR code generation process', 'QR', { error: error.message });
      throw new Error(`Failed to get QR code: ${error.message}`);
    }
  }

  async getQRCodeDirect(handleSessionStatusFn, pollForQRCodeFn) {
    try {
      logger.info('QR', 'Attempting QR code generation with WAHA Core...');
      
      // Check session status and handle accordingly
      const sessionResult = await handleSessionStatusFn();
      
      // If session already returned success (already connected), return it
      if (sessionResult && sessionResult.success) {
        return sessionResult;
      }
      
      // Poll for QR readiness
      const pollResult = await pollForQRCodeFn();
      
      // If poll already returned success (already connected), return it
      if (pollResult && pollResult.success) {
        return pollResult;
      }
      
      return pollResult;
    } catch (error) {
      logger.error('Error in WAHA Core QR generation', 'QR', { error: error.message });
      throw error;
    }
  }

  async handleSessionStatus(getSessionInfoFn, safeStartWebhookMonitorFn, attemptStartWithBackoffFn) {
    try {
      const sessionResponse = await getSessionInfoFn();
      logger.info('QR', 'Session status', { status: sessionResponse.data.status });
      
      safeStartWebhookMonitorFn();
      
      if (sessionResponse.data.status === 'WORKING') {
        logger.info('QR', 'Session is already authenticated and working');
        if (sessionResponse.data.me) {
          logger.info('QR', 'Connected as', { user: sessionResponse.data.me.pushName || sessionResponse.data.me.id });
        }
        // Instead of throwing an error, return success with connected status
        return {
          success: true,
          alreadyConnected: true,
          message: 'WhatsApp is already connected',
          user: sessionResponse.data.me?.pushName || sessionResponse.data.me?.id
        };
      }
      
      if (sessionResponse.data.status === 'STOPPED') {
        logger.info('QR', 'Session is stopped, attempting start with backoff...');
        await attemptStartWithBackoffFn(this.sessionName, 'initial-check');
      }
    } catch (sessionError) {
      if (sessionError.message.includes('already connected')) throw sessionError;
      
      logger.warn('QR', 'Session does not exist or error checking', { error: sessionError.message });
      await attemptStartWithBackoffFn(this.sessionName, 'not-exists');
    }
  }

  async pollForQRCode(checkSessionStatusFn, attemptStartWithBackoffFn, sleepFn) {
    const pollTimeoutMs = 60000;
    const pollIntervalMs = 1500;
    const startTs = Date.now();
    let lastLoggedStatus = '';
    
    while (Date.now() - startTs < pollTimeoutMs) {
      // Check and log session status
      const status = await checkSessionStatusFn(lastLoggedStatus);
      if (status !== lastLoggedStatus) {
        lastLoggedStatus = status;
        logger.info('QR', `Session '${this.sessionName}' status`, { status });
      }
      
      if (status === 'WORKING' || status === 'AUTHENTICATED') {
        // Instead of throwing an error, return success with connected status
        return {
          success: true,
          alreadyConnected: true,
          message: 'WhatsApp is already connected',
          status: status
        };
      }
      
      if (status === 'STOPPED' || status === 'FAILED') {
        await attemptStartWithBackoffFn(this.sessionName, `poll-${status.toLowerCase()}`);
      }
      
      // Try to fetch QR code if ready
      if (status === 'SCAN_QR_CODE') {
        const qrCode = await this.fetchQRCode();
        if (qrCode) return qrCode;
      }
      
      await sleepFn(pollIntervalMs);
    }
    
    throw new Error('QR not ready yet. Please try again.');
  }

  async checkSessionStatus(lastStatus, getSessionInfoFn) {
    try {
      const info = await getSessionInfoFn();
      const status = info?.data?.status || 'UNKNOWN';
      if (info?.data?.message && status !== lastStatus) {
        logger.info('QR', `Session message: ${info.data.message}`);
      }
      return status;
    } catch (_) {
      return 'UNKNOWN';
    }
  }

  async fetchQRCode() {
    try {
      logger.info('QR', 'Getting QR code from session...');
      const qrResponse = await httpClient.get(`${this.baseURL}/api/${this.sessionName}/auth/qr`, {
        timeout: 15000,
        headers: { 'Accept': 'application/json' }
      });
      
      if (qrResponse?.data) {
        const qrCode = this.formatQRCode(qrResponse.data);
        this.lastQRCode = qrCode;
        return qrCode;
      }
    } catch (qrError) {
      const status = qrError?.response?.status;
      if (status !== 422 && status !== 404) {
        logger.warn('QR', 'QR code retrieval error', { error: qrError.message });
      }
    }
    return null;
  }

  formatQRCode(qrData) {
    if (typeof qrData === 'string' && qrData.startsWith('data:image')) return qrData;
    if (qrData.data && qrData.mimetype) return `data:${qrData.mimetype};base64,${qrData.data}`;
    if (typeof qrData === 'string') return `data:image/png;base64,${qrData}`;
    throw new Error('Invalid QR code format received');
  }

  // Session management for QR
  async startSessionForQR(resetCachesFn, startSessionIfNeededFn, safeStartWebhookMonitorFn, safeEnsureWebhookFn) {
    try {
      logger.info('QR', 'Starting session for QR code...');
      resetCachesFn();
      
      const sess = this.sessionName;
      if (this._qrStartInProgress.get(sess)) {
        logger.debug('QR', `QR start already in progress for session '${sess}', skipping duplicate start.`);
        return;
      }
      
      this._qrStartInProgress.set(sess, true);
      try {
        await startSessionIfNeededFn(sess);
      } finally {
        this._qrStartInProgress.delete(sess);
      }
      
      safeStartWebhookMonitorFn();
      return { started: true };
    } catch (startError) {
      logger.warn('QR', 'Session start failed', { error: startError.message });
      if (startError.response?.status === 422) {
        logger.debug('QR', 'Session might already exist, continuing...');
        safeStartWebhookMonitorFn();
        safeEnsureWebhookFn();
        return;
      }
      throw startError;
    }
  }

  // Legacy methods for compatibility
  async createSessionAndGetQR(safeStartWebhookMonitorFn, waitForSessionReadyFn) {
    try {
      logger.info('QR', 'Starting WAHA session...');
      
      const startResponse = await httpClient.post(`${this.baseURL}/api/sessions/start`, {
        name: this.sessionName
      }, {
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' }
      });
      logger.info('QR', 'Session start response', { status: startResponse.status, data: startResponse.data });

      safeStartWebhookMonitorFn();
      await waitForSessionReadyFn();
      return await this.getQRCode();
    } catch (error) {
      logger.error('Error in createSessionAndGetQR', 'QR', { error: error.message });
      throw new Error(`Failed to get QR code: ${error.message}`);
    }
  }

  async waitForSessionReady(maxAttempts = 10, getSessionInfoFn, sleepFn) {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const sessionInfo = await getSessionInfoFn();
        const status = sessionInfo.data.status;
        logger.info('QR', 'Session status', { status });
        
        if (status === 'SCAN_QR_CODE') {
          logger.info('QR', 'Session ready for QR code');
          return;
        }
        
        if (status === 'WORKING') {
          throw new Error('Session is already authenticated');
        }
        
        await sleepFn(1000);
      } catch (error) {
        logger.error(`Attempt ${i + 1} failed`, 'QR', { attempt: i + 1, error: error.message });
        if (i === maxAttempts - 1) throw error;
        await sleepFn(1000);
      }
    }
    throw new Error('Session did not reach ready state in time');
  }

  async startAuthentication() {
    try {
      logger.info('QR', 'Starting authentication process...');
      const response = await httpClient.post(`${this.baseURL}/api/${this.sessionName}/auth/request-code`, {}, {
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' }
      });
      logger.info('QR', 'Authentication process started', { data: response.data });
      await this._sleep(3000);
    } catch (error) {
      logger.debug('QR', 'Auth request not needed or failed (this might be normal)', { error: error.message });
    }
  }

  // Removed fetchQRCodeLegacy; use fetchQRCode() for current WAHA versions

  // Utility methods
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  isQRStartInProgress(sessionName) {
    return this._qrStartInProgress.get(sessionName || this.sessionName);
  }

  clearQRStartProgress(sessionName) {
    this._qrStartInProgress.delete(sessionName || this.sessionName);
  }
}

module.exports = WAHAQRManager;
