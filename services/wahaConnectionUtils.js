const httpClient = require('../utils/httpClient');
const logger = require('../utils/logger');

class WAHAConnectionUtils {
  constructor(baseURL) {
    this.baseURL = baseURL;
    this.connectionCache = new Map();
  }

  // Core connection checking
  async checkConnection() {
    try {
      const DEBUG = logger.isLevelEnabled('DEBUG');
      if (DEBUG) logger.debug('Connection', 'Checking WAHA API connection...');
      
      const response = await httpClient.get(`${this.baseURL}/api/sessions`, {
        timeout: 10000,
        headers: {
          'Accept': 'application/json'
        }
      });
      
      if (DEBUG) {
        logger.info('Connection', 'WAHA API connection successful');
        logger.info('Connection', 'Available sessions', { count: response.data?.length || 0 });
      }
      
      return {
        connected: true,
        status: 'healthy',
        sessions: response.data || [],
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      // Keep errors concise in normal mode
      const DEBUG = logger.isLevelEnabled('DEBUG');
      if (DEBUG) logger.error('WAHA API connection failed', 'Connection', { error: error.message });
      
      return {
        connected: false,
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  async checkConnectionWithRetry(maxRetries = 3, retryDelay = 2000) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const DEBUG = logger.isLevelEnabled('DEBUG');
        if (DEBUG) logger.debug('Connection', `Connection attempt ${attempt}/${maxRetries}...`);
        const result = await this.checkConnection();
        
        if (result.connected) {
          if (DEBUG) logger.info('Connection', `Connection successful on attempt ${attempt}`);
          return result;
        }
        
        lastError = new Error(result.error || 'Connection failed');
      } catch (error) {
        lastError = error;
        const DEBUG = logger.isLevelEnabled('DEBUG');
        if (DEBUG) logger.error(`Attempt ${attempt} failed`, 'Connection', { error: error.message });
      }
      
      if (attempt < maxRetries) {
        const DEBUG = logger.isLevelEnabled('DEBUG');
        if (DEBUG) logger.debug('Connection', `Waiting ${retryDelay}ms before retry...`);
        await this._sleep(retryDelay);
      }
    }
    
    throw new Error(`Connection failed after ${maxRetries} attempts: ${lastError.message}`);
  }

  // Health check methods
  async getAPIHealth() {
    try {
      logger.info('Health', 'Checking WAHA API health...');
      
      const response = await httpClient.get(`${this.baseURL}/api/health`, {
        timeout: 5000,
        headers: {
          'Accept': 'application/json'
        }
      });
      
      logger.info('Health', 'API health check successful', { data: response.data });
      return {
        healthy: true,
        data: response.data,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('API health check failed', 'Health', { error: error.message });
      return {
        healthy: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  async getAPIVersion() {
    try {
      logger.info('Version', 'Getting WAHA API version...');
      
      const response = await httpClient.get(`${this.baseURL}/api/version`, {
        timeout: 5000,
        headers: {
          'Accept': 'application/json'
        }
      });
      
      logger.info('Version', 'API version', { version: response.data });
      return response.data;
    } catch (error) {
      logger.error('Failed to get API version', 'Version', { error: error.message });
      throw error;
    }
  }

  // Session connectivity
  async checkSessionConnectivity(sessionName) {
    try {
      logger.info('Session', `Checking connectivity for session '${sessionName}'...`);
      
      const response = await httpClient.get(`${this.baseURL}/api/sessions/${sessionName}`, {
        timeout: 8000,
        headers: {
          'Accept': 'application/json'
        }
      });
      
      const status = response.data?.status || 'UNKNOWN';
      logger.info('Session', `Session '${sessionName}' connectivity status`, { status });
      
      return {
        reachable: true,
        status: status,
        data: response.data,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error(`Session '${sessionName}' connectivity check failed`, 'Session', { sessionName, error: error.message });
      
      return {
        reachable: false,
        status: 'UNREACHABLE',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  // Network diagnostics
  async performNetworkDiagnostics() {
    logger.info('Diagnostics', 'Performing network diagnostics...');
    
    const diagnostics = {
      timestamp: new Date().toISOString(),
      baseURL: this.baseURL,
      tests: {}
    };
    
    // Test basic connectivity
    try {
      const startTime = Date.now();
      await this.checkConnection();
      diagnostics.tests.basicConnectivity = {
        passed: true,
        responseTime: Date.now() - startTime
      };
    } catch (error) {
      diagnostics.tests.basicConnectivity = {
        passed: false,
        error: error.message
      };
    }
    
    // Test API health
    try {
      const startTime = Date.now();
      const health = await this.getAPIHealth();
      diagnostics.tests.apiHealth = {
        passed: health.healthy,
        responseTime: Date.now() - startTime,
        data: health.data
      };
    } catch (error) {
      diagnostics.tests.apiHealth = {
        passed: false,
        error: error.message
      };
    }
    
    // Test API version
    try {
      const startTime = Date.now();
      const version = await this.getAPIVersion();
      diagnostics.tests.apiVersion = {
        passed: true,
        responseTime: Date.now() - startTime,
        version: version
      };
    } catch (error) {
      diagnostics.tests.apiVersion = {
        passed: false,
        error: error.message
      };
    }
    
    logger.info('Diagnostics', 'Network diagnostics completed', { diagnostics });
    return diagnostics;
  }

  // Connection monitoring
  async startConnectionMonitoring(intervalMs = 30000, onStatusChange = null) {
    logger.info('Monitor', `Starting connection monitoring (interval: ${intervalMs}ms)...`);
    
    let lastStatus = null;
    
    const monitor = async () => {
      try {
        const result = await this.checkConnection();
        const currentStatus = result.connected ? 'connected' : 'disconnected';
        
        if (currentStatus !== lastStatus) {
          logger.info('Monitor', `Connection status changed: ${lastStatus} -> ${currentStatus}`);
          lastStatus = currentStatus;
          
          if (onStatusChange) {
            try {
              await onStatusChange(currentStatus, result);
            } catch (callbackError) {
              logger.error('Error in status change callback', 'Callback', { error: callbackError.message });
            }
          }
        }
      } catch (error) {
        logger.error('Error in connection monitoring', 'Monitor', { error: error.message });
      }
    };
    
    // Initial check
    await monitor();
    
    // Set up interval
    const intervalId = setInterval(monitor, intervalMs);
    
    return {
      stop: () => {
        logger.info('Monitor', 'Stopping connection monitoring...');
        clearInterval(intervalId);
      },
      intervalId: intervalId
    };
  }

  // HTTP client wrapper methods
  async makeRequest(method, endpoint, data = null, options = {}) {
    try {
      const url = endpoint.startsWith('http') ? endpoint : `${this.baseURL}${endpoint}`;
      const config = {
        method: method.toUpperCase(),
        url: url,
        timeout: options.timeout || 10000,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...options.headers
        },
        ...options
      };
      
      if (data && ['POST', 'PUT', 'PATCH'].includes(config.method)) {
        config.data = data;
      }
      
      logger.debug('Request', `Making ${method.toUpperCase()} request to: ${url}`);
      const response = await httpClient.request(config);
      
      logger.debug('Request', `${method.toUpperCase()} request successful`, { status: response.status });
      return response;
    } catch (error) {
      logger.error(`${method.toUpperCase()} request failed`, 'Request', { method: method.toUpperCase(), error: error.message });
      throw error;
    }
  }

  async get(endpoint, options = {}) {
    return this.makeRequest('GET', endpoint, null, options);
  }

  async post(endpoint, data, options = {}) {
    return this.makeRequest('POST', endpoint, data, options);
  }

  async put(endpoint, data, options = {}) {
    return this.makeRequest('PUT', endpoint, data, options);
  }

  async delete(endpoint, options = {}) {
    return this.makeRequest('DELETE', endpoint, null, options);
  }

  // Cache management
  cacheConnection(key, result, ttlMs = 30000) {
    this.connectionCache.set(key, {
      result: result,
      timestamp: Date.now(),
      ttl: ttlMs
    });
  }

  getCachedConnection(key) {
    const cached = this.connectionCache.get(key);
    if (!cached) return null;
    
    const now = Date.now();
    if (now - cached.timestamp > cached.ttl) {
      this.connectionCache.delete(key);
      return null;
    }
    
    return cached.result;
  }

  clearConnectionCache() {
    this.connectionCache.clear();
    logger.info('Cache', 'Connection cache cleared');
  }

  // Utility methods
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  isValidURL(url) {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  parseBaseURL(url) {
    try {
      const parsed = new URL(url);
      return {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port,
        pathname: parsed.pathname,
        full: `${parsed.protocol}//${parsed.host}${parsed.pathname}`
      };
    } catch (error) {
      throw new Error(`Invalid URL: ${url}`);
    }
  }

  // Connection statistics
  getConnectionStats() {
    return {
      baseURL: this.baseURL,
      cacheSize: this.connectionCache.size,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = WAHAConnectionUtils;
