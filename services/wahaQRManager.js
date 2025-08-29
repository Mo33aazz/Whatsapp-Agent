const httpClient = require('../utils/httpClient');

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
      console.log('Starting QR code generation process...');
      const qrCode = await this.getQRCodeDirect();
      console.log('QR code generated successfully');
      return qrCode;
    } catch (error) {
      console.error('Error in QR code generation process:', error.message);
      throw new Error(`Failed to get QR code: ${error.message}`);
    }
  }

  async getQRCodeDirect(handleSessionStatusFn, pollForQRCodeFn) {
    try {
      console.log('Attempting QR code generation with WAHA Core...');
      
      // Check session status and handle accordingly
      await handleSessionStatusFn();
      
      // Poll for QR readiness
      return await pollForQRCodeFn();
    } catch (error) {
      console.error('Error in WAHA Core QR generation:', error.message);
      throw error;
    }
  }

  async handleSessionStatus(getSessionInfoFn, safeStartWebhookMonitorFn, attemptStartWithBackoffFn) {
    try {
      const sessionResponse = await getSessionInfoFn();
      console.log('Session status:', sessionResponse.data.status);
      
      safeStartWebhookMonitorFn();
      
      if (sessionResponse.data.status === 'WORKING') {
        console.log('Session is already authenticated and working');
        if (sessionResponse.data.me) {
          console.log('Connected as:', sessionResponse.data.me.pushName || sessionResponse.data.me.id);
        }
        throw new Error('WhatsApp is already connected. No QR code needed.');
      }
      
      if (sessionResponse.data.status === 'STOPPED') {
        console.log('Session is stopped, attempting start with backoff...');
        await attemptStartWithBackoffFn(this.sessionName, 'initial-check');
      }
    } catch (sessionError) {
      if (sessionError.message.includes('already connected')) throw sessionError;
      
      console.log('Session does not exist or error checking:', sessionError.message);
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
        console.log(`Session '${this.sessionName}' status: ${status}`);
      }
      
      if (status === 'WORKING' || status === 'AUTHENTICATED') {
        throw new Error('WhatsApp is already connected. No QR code needed.');
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
        console.log(`Session message: ${info.data.message}`);
      }
      return status;
    } catch (_) {
      return 'UNKNOWN';
    }
  }

  async fetchQRCode() {
    try {
      console.log('Getting QR code from session...');
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
        console.log('QR code retrieval error:', qrError.message);
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
      console.log('Starting session for QR code...');
      resetCachesFn();
      
      const sess = this.sessionName;
      if (this._qrStartInProgress.get(sess)) {
        console.log(`QR start already in progress for session '${sess}', skipping duplicate start.`);
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
      console.log('Session start failed:', startError.message);
      if (startError.response?.status === 422) {
        console.log('Session might already exist, continuing...');
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
      console.log('Starting WAHA session...');
      
      const startResponse = await httpClient.post(`${this.baseURL}/api/sessions/start`, {
        name: this.sessionName
      }, {
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' }
      });
      console.log('Session start response:', startResponse.status, startResponse.data);

      safeStartWebhookMonitorFn();
      await waitForSessionReadyFn();
      return await this.getQRCode();
    } catch (error) {
      console.error('Error in createSessionAndGetQR:', error.message);
      throw new Error(`Failed to get QR code: ${error.message}`);
    }
  }

  async waitForSessionReady(maxAttempts = 10, getSessionInfoFn, sleepFn) {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const sessionInfo = await getSessionInfoFn();
        const status = sessionInfo.data.status;
        console.log(`Session status: ${status}`);
        
        if (status === 'SCAN_QR_CODE') {
          console.log('Session ready for QR code');
          return;
        }
        
        if (status === 'WORKING') {
          throw new Error('Session is already authenticated');
        }
        
        await sleepFn(1000);
      } catch (error) {
        console.error(`Attempt ${i + 1} failed:`, error.message);
        if (i === maxAttempts - 1) throw error;
        await sleepFn(1000);
      }
    }
    throw new Error('Session did not reach ready state in time');
  }

  async startAuthentication() {
    try {
      console.log('Starting authentication process...');
      const response = await httpClient.post(`${this.baseURL}/api/${this.sessionName}/auth/request-code`, {}, {
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' }
      });
      console.log('Authentication process started:', response.data);
      await this._sleep(3000);
    } catch (error) {
      console.log('Auth request not needed or failed (this might be normal):', error.message);
    }
  }

  // Alternative QR fetch method (legacy)
  async fetchQRCodeLegacy() {
    try {
      console.log('Fetching QR code...');
      const response = await httpClient.get(`${this.baseURL}/api/${this.sessionName}/auth/qr`, {
        timeout: 15000,
        headers: { 'Accept': 'application/json' }
      });
      
      console.log('QR Code Response Status:', response.status);
      console.log('QR Code Response Data Type:', typeof response.data);
      
      if (!response.data) throw new Error('No QR code available in response');
      
      // Handle different response formats
      const { data } = response;
      if (typeof data === 'string' && data.startsWith('data:image')) return data;
      if (data.data && data.mimetype) {
        console.log('Converting WAHA response format to data URI');
        return `data:${data.mimetype};base64,${data.data}`;
      }
      if (data.qr) return `data:image/png;base64,${data.qr}`;
      if (data.base64) return `data:image/png;base64,${data.base64}`;
      if (typeof data === 'string' && data.length > 0) {
        console.log('Converting raw base64 string to data URI');
        return `data:image/png;base64,${data}`;
      }
      
      throw new Error('No QR code available in response');
    } catch (error) {
      console.error('Error fetching QR code:', error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
      }
      throw error;
    }
  }

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