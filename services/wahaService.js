const axios = require('axios');

class WAHAService {
  constructor() {
    this.baseURL = process.env.WAHA_URL || 'http://localhost:3000';
    this.sessionName = 'default'; // WAHA Core only supports 'default' session
    this.lastQRCode = null;
    this.sessionStatus = 'STOPPED';
  }

  /**
   * Get QR code for WhatsApp authentication
   * @returns {Promise<string>} Base64 encoded QR code image
   */
  async getQRCode() {
    try {
      console.log('Starting QR code generation process...');
      
      // Try direct QR code approach for free WAHA version
      const qrCode = await this.getQRCodeDirect();
      
      console.log('QR code generated successfully');
      return qrCode;
    } catch (error) {
      console.error('Error in QR code generation process:', error.message);
      throw new Error(`Failed to get QR code: ${error.message}`);
    }
  }

  /**
   * Get QR code using WAHA Core approach (free version)
   */
  async getQRCodeDirect() {
    try {
      console.log('Attempting QR code generation with WAHA Core...');
      
      // First, check if session exists and its status
      let sessionExists = false;
      try {
        const sessionResponse = await axios.get(`${this.baseURL}/api/sessions/${this.sessionName}`, {
          timeout: 5000
        });
        sessionExists = true;
        console.log('Session status:', sessionResponse.data.status);
        
        // If session is already authenticated, return a message
        if (sessionResponse.data.status === 'WORKING') {
          console.log('Session is already authenticated and working');
          if (sessionResponse.data.me) {
            console.log('Connected as:', sessionResponse.data.me.pushName || sessionResponse.data.me.id);
          }
          throw new Error('WhatsApp is already connected. No QR code needed.');
        }
        
        // If session is stopped, start it
        if (sessionResponse.data.status === 'STOPPED') {
          console.log('Session is stopped, starting it...');
          await this.startSessionForQR();
        }
      } catch (sessionError) {
        // If it's our custom error about already being connected, re-throw it
        if (sessionError.message.includes('already connected')) {
          throw sessionError;
        }
        console.log('Session does not exist or error checking:', sessionError.message);
        // Try to start the session
        await this.startSessionForQR();
      }
      
      // Wait a moment for session to initialize
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Now try to get QR code
      try {
        console.log('Getting QR code from session...');
        const qrResponse = await axios.get(`${this.baseURL}/api/${this.sessionName}/auth/qr`, {
          timeout: 15000,
          headers: {
            'Accept': 'application/json'
          }
        });
        
        console.log('QR Code Response Status:', qrResponse.status);
        console.log('QR Code Response Data:', typeof qrResponse.data);
        
        if (qrResponse.data) {
          let qrCode = this.formatQRCode(qrResponse.data);
          this.lastQRCode = qrCode;
          return qrCode;
        }
      } catch (qrError) {
        console.log('QR code retrieval failed:', qrError.message);
        throw qrError;
      }
      
    } catch (error) {
      console.error('Error in WAHA Core QR generation:', error.message);
      throw error;
    }
  }

  /**
   * Start session for QR code generation
   */
  async startSessionForQR() {
    try {
      console.log('Starting session for QR code...');
      const startResponse = await axios.post(`${this.baseURL}/api/sessions/start`, {
        name: this.sessionName
      }, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
      });
      console.log('Session start response:', startResponse.status, startResponse.data);
      return startResponse.data;
    } catch (startError) {
      console.log('Session start failed:', startError.message);
      // If it's a 422 error, session might already exist
      if (startError.response && startError.response.status === 422) {
        console.log('Session might already exist, continuing...');
        return;
      }
      throw startError;
    }
  }

  /**
   * Format QR code data into proper data URI
   */
  formatQRCode(qrData) {
    if (typeof qrData === 'string' && qrData.startsWith('data:image')) {
      return qrData;
    } else if (qrData.data && qrData.mimetype) {
      return `data:${qrData.mimetype};base64,${qrData.data}`;
    } else if (typeof qrData === 'string') {
      return `data:image/png;base64,${qrData}`;
    } else {
      throw new Error('Invalid QR code format received');
    }
  }

  /**
   * Create session and immediately get QR code (fallback approach)
   */
  async createSessionAndGetQR() {
    try {
      console.log('Starting WAHA session...');
      
      // Start the session using the correct endpoint
      const startResponse = await axios.post(`${this.baseURL}/api/sessions/start`, {
        name: this.sessionName
      }, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
      });
      console.log('Session start response:', startResponse.status, startResponse.data);
      
      // Wait for session to reach SCAN_QR_CODE status
      await this.waitForSessionReady();
      
      // Get QR code
      return await this.getQRCode();
    } catch (error) {
      console.error('Error in createSessionAndGetQR:', error.message);
      throw new Error(`Failed to get QR code: ${error.message}`);
    }
  }

  async waitForSessionReady(maxAttempts = 10) {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const sessionInfo = await axios.get(`${this.baseURL}/api/sessions/${this.sessionName}`);
        const status = sessionInfo.data.status;
        console.log(`Session status: ${status}`);
        
        if (status === 'SCAN_QR_CODE') {
          console.log('Session ready for QR code');
          return;
        }
        
        if (status === 'WORKING') {
          throw new Error('Session is already authenticated');
        }
        
        // Wait before next check
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Attempt ${i + 1} failed:`, error.message);
        if (i === maxAttempts - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    throw new Error('Session did not reach ready state in time');
  }

  // Removed duplicate getQRCode method - using the one at line 16 instead

  // Removed duplicate formatQRCode and waitForSessionReady methods - using the ones defined above

  /**
   * Start the authentication process
   */
  async startAuthentication() {
    try {
      console.log('Starting authentication process...');
      
      const response = await axios.post(`${this.baseURL}/api/${this.sessionName}/auth/request-code`, {}, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      console.log('Authentication process started:', response.data);
      
      // Wait for QR code to be generated
      await new Promise(resolve => setTimeout(resolve, 3000));
      
    } catch (error) {
      // Some WAHA versions might not need explicit auth request
      console.log('Auth request not needed or failed (this might be normal):', error.message);
    }
  }

  /**
   * Fetch the actual QR code
   */
  async fetchQRCode() {
    try {
      console.log('Fetching QR code...');
      
      const response = await axios.get(`${this.baseURL}/api/${this.sessionName}/auth/qr`, {
        timeout: 15000,
        headers: {
          'Accept': 'application/json'
        }
      });
      
      console.log('QR Code Response Status:', response.status);
      console.log('QR Code Response Data Type:', typeof response.data);
      
      // Handle different possible response formats
      if (response.data) {
        // If response.data is already a base64 string with data URI
        if (typeof response.data === 'string' && response.data.startsWith('data:image')) {
          return response.data;
        }
        
        // If response.data is an object with mimetype and data properties (WAHA format)
        if (response.data.data && response.data.mimetype) {
          console.log('Converting WAHA response format to data URI');
          return `data:${response.data.mimetype};base64,${response.data.data}`;
        }
        
        // If response.data has a qr property
        if (response.data.qr) {
          return `data:image/png;base64,${response.data.qr}`;
        }
        
        // If response.data is an object with base64 property
        if (response.data.base64) {
          return `data:image/png;base64,${response.data.base64}`;
        }
        
        // If response.data is a base64 string without data URI prefix
        if (typeof response.data === 'string' && response.data.length > 0) {
          console.log('Converting raw base64 string to data URI');
          return `data:image/png;base64,${response.data}`;
        }
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

  /**
   * Check if WAHA API is connected and responsive
   * @returns {Promise<boolean>} Connection status
   */
  async checkConnection() {
    try {
      const response = await axios.get(`${this.baseURL}/api/sessions`, {
        timeout: 5000
      });
      return response.status === 200;
    } catch (error) {
      console.error('WAHA connection check failed:', error.message);
      return false;
    }
  }

  /**
   * Get session status from WAHA
   * @returns {Promise<Object>} Session status information
   */
  async getSessionStatus() {
    try {
      const response = await axios.get(`${this.baseURL}/api/sessions/${this.sessionName}`, {
        timeout: 5000
      });
      return response.data;
    } catch (error) {
      console.error('Error getting session status:', error.message);
      return { status: 'FAILED', message: error.message };
    }
  }

  /**
   * Send a text message via WAHA
   * @param {string} chatId - WhatsApp chat ID (phone number with @c.us)
   * @param {string} text - Message text to send
   * @returns {Promise<Object>} Send result
   */
  async sendMessage(chatId, text) {
    try {
      const response = await axios.post(`${this.baseURL}/api/sendText`, {
        session: this.sessionName,
        chatId: chatId,
        text: text
      }, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      return response.data;
    } catch (error) {
      console.error('Error sending message via WAHA:', error.message);
      throw new Error(`Failed to send message: ${error.message}`);
    }
  }

  /**
   * Start a new session or update existing one (for authenticated sessions)
   * @returns {Promise<Object>} Session start result
   */
  async startOrUpdateSession() {
    try {
      // For 'default' session, use /waha-events endpoint, otherwise use /webhook
      // Use host.docker.internal so WAHA Docker container can reach our webhook
      const webhookUrl = this.sessionName === 'default' 
        ? `http://host.docker.internal:${process.env.PORT || 3001}/waha-events`
        : `http://host.docker.internal:${process.env.PORT || 3001}/webhook`;
      
      // Session creation payload with webhook configuration
      const sessionData = {
        name: this.sessionName,
        config: {
          webhooks: [{
            url: webhookUrl,
            events: this.sessionName === 'default' 
              ? ['message', 'session.status', 'message.any', 'state.change']
              : ['message', 'session.status'],
            hmac: null,
            retries: {
              policy: "constant",
              delaySeconds: 2,
              attempts: 3
            }
          }]
        }
      };
      
      console.log('Creating/updating authenticated session with data:', JSON.stringify(sessionData, null, 2));
      
      let response;
      try {
        // Try to create new session first
        response = await axios.post(`${this.baseURL}/api/sessions`, sessionData, {
          timeout: 15000,
          headers: {
            'Content-Type': 'application/json'
          }
        });
        console.log('Authenticated session created successfully:', response.data);
      } catch (createError) {
        console.error('Session creation failed with error:', {
          status: createError.response?.status,
          statusText: createError.response?.statusText,
          data: createError.response?.data,
          message: createError.message,
          url: `${this.baseURL}/api/sessions`
        });
        
        if (createError.response && createError.response.status === 422) {
          // Session already exists, try to update it
          console.log('Session exists (422 error), attempting to update it...');
          try {
            response = await axios.put(`${this.baseURL}/api/sessions/${this.sessionName}`, sessionData, {
              timeout: 15000,
              headers: {
                'Content-Type': 'application/json'
              }
            });
            console.log('Authenticated session updated successfully:', response.data);
          } catch (updateError) {
            console.error('Session update also failed:', {
              status: updateError.response?.status,
              statusText: updateError.response?.statusText,
              data: updateError.response?.data,
              message: updateError.message,
              url: `${this.baseURL}/api/sessions/${this.sessionName}`
            });
            throw updateError;
          }
        } else {
          throw createError;
        }
      }
      
      return response.data;
    } catch (error) {
      console.error('Error starting/updating authenticated WAHA session:', error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
      }
      throw new Error(`Failed to start/update authenticated session: ${error.message}`);
    }
  }

  /**
   * Start a new session (legacy method for compatibility)
   * @returns {Promise<Object>} Session start result
   */
  async startSession() {
    return this.startOrUpdateSession();
  }

  /**
   * Configure webhook for the session (separate call)
   * @param {string} webhookUrl - Webhook URL
   * @returns {Promise<void>}
   */
  async configureWebhook(webhookUrl) {
    try {
      const webhookData = {
        url: webhookUrl,
        events: ['message', 'session.status'],
        hmac: null,
        retries: {
          policy: "constant",
          delaySeconds: 2,
          attempts: 3
        }
      };
      
      await axios.post(`${this.baseURL}/api/sessions/${this.sessionName}/webhooks`, webhookData, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      console.log('Webhook configured successfully');
    } catch (error) {
      console.error('Webhook configuration error:', error.message);
      throw error;
    }
  }

  /**
   * Stop the current session
   * @returns {Promise<Object>} Session stop result
   */
  async stopSession() {
    try {
      const response = await axios.delete(`${this.baseURL}/api/sessions/${this.sessionName}`, {
        timeout: 10000
      });
      
      return response.data;
    } catch (error) {
      console.error('Error stopping WAHA session:', error.message);
      throw new Error(`Failed to stop session: ${error.message}`);
    }
  }

  /**
   * Ensure session is started and authenticated before operations
   * @returns {Promise<void>}
   */
  async ensureSessionStarted() {
    try {
      const status = await this.getSessionStatus();
      console.log('Current session status:', status);
      
      if (!status || status.status !== 'WORKING') {
        console.log('Session not authenticated, need to scan QR code first');
        throw new Error('Session not authenticated. Please scan QR code first.');
      } else {
        console.log('Session is authenticated and ready (status:', status.status, ')');
      }
    } catch (error) {
      console.error('Session check error:', error.message);
      throw new Error(`Session not ready for operations: ${error.message}`);
    }
  }

  /**
   * Setup webhook after successful authentication
   * Note: Webhook is now configured during session creation, so this method is simplified
   * @returns {Promise<void>}
   */
  async setupWebhookAfterAuth() {
    try {
      console.log('Webhook already configured during session creation - no additional setup needed');
      // Webhook is already configured in the session creation payload
      // No need for separate webhook configuration calls
    } catch (error) {
      console.error('Failed to setup webhook after authentication:', error.message);
      // Don't throw error as this is not critical for basic functionality
    }
  }

  /**
   * Configure WAHA events webhook to send events to /waha-events endpoint
   * @returns {Promise<void>}
   */
  async configureWahaEventsWebhook() {
    try {
      const webhookUrl = `http://host.docker.internal:${process.env.PORT || 3001}/waha-events`;
      const webhookData = {
        url: webhookUrl,
        events: ['message', 'session.status', 'message.any', 'state.change'],
        hmac: null,
        retries: {
          policy: "constant",
          delaySeconds: 2,
          attempts: 3
        }
      };
      
      await axios.post(`${this.baseURL}/api/sessions/${this.sessionName}/webhooks`, webhookData, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      console.log('WAHA events webhook configured successfully to:', webhookUrl);
    } catch (error) {
      console.error('WAHA events webhook configuration error:', error.message);
      throw error;
    }
  }

  /**
   * Check if session is authenticated
   * @returns {Promise<boolean>}
   */
  async isAuthenticated() {
    try {
      const status = await this.getSessionStatus();
      return status && status.status === 'WORKING';
    } catch (error) {
      console.error('Error checking authentication status:', error.message);
      return false;
    }
  }
}

module.exports = new WAHAService();