const httpClient = require('../utils/httpClient');

class WAHAConnectionUtils {
  constructor(baseURL) {
    this.baseURL = baseURL;
    this.connectionCache = new Map();
  }

  // Core connection checking
  async checkConnection() {
    try {
      console.log('Checking WAHA API connection...');
      
      const response = await httpClient.get(`${this.baseURL}/api/sessions`, {
        timeout: 10000,
        headers: {
          'Accept': 'application/json'
        }
      });
      
      console.log('WAHA API connection successful');
      console.log('Available sessions:', response.data?.length || 0);
      
      return {
        connected: true,
        status: 'healthy',
        sessions: response.data || [],
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('WAHA API connection failed:', error.message);
      
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
        console.log(`Connection attempt ${attempt}/${maxRetries}...`);
        const result = await this.checkConnection();
        
        if (result.connected) {
          console.log(`Connection successful on attempt ${attempt}`);
          return result;
        }
        
        lastError = new Error(result.error || 'Connection failed');
      } catch (error) {
        lastError = error;
        console.error(`Attempt ${attempt} failed:`, error.message);
      }
      
      if (attempt < maxRetries) {
        console.log(`Waiting ${retryDelay}ms before retry...`);
        await this._sleep(retryDelay);
      }
    }
    
    throw new Error(`Connection failed after ${maxRetries} attempts: ${lastError.message}`);
  }

  // Health check methods
  async getAPIHealth() {
    try {
      console.log('Checking WAHA API health...');
      
      const response = await httpClient.get(`${this.baseURL}/api/health`, {
        timeout: 5000,
        headers: {
          'Accept': 'application/json'
        }
      });
      
      console.log('API health check successful:', response.data);
      return {
        healthy: true,
        data: response.data,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('API health check failed:', error.message);
      return {
        healthy: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  async getAPIVersion() {
    try {
      console.log('Getting WAHA API version...');
      
      const response = await httpClient.get(`${this.baseURL}/api/version`, {
        timeout: 5000,
        headers: {
          'Accept': 'application/json'
        }
      });
      
      console.log('API version:', response.data);
      return response.data;
    } catch (error) {
      console.error('Failed to get API version:', error.message);
      throw error;
    }
  }

  // Session connectivity
  async checkSessionConnectivity(sessionName) {
    try {
      console.log(`Checking connectivity for session '${sessionName}'...`);
      
      const response = await httpClient.get(`${this.baseURL}/api/sessions/${sessionName}`, {
        timeout: 8000,
        headers: {
          'Accept': 'application/json'
        }
      });
      
      const status = response.data?.status || 'UNKNOWN';
      console.log(`Session '${sessionName}' connectivity status:`, status);
      
      return {
        reachable: true,
        status: status,
        data: response.data,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error(`Session '${sessionName}' connectivity check failed:`, error.message);
      
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
    console.log('Performing network diagnostics...');
    
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
    
    console.log('Network diagnostics completed:', diagnostics);
    return diagnostics;
  }

  // Connection monitoring
  async startConnectionMonitoring(intervalMs = 30000, onStatusChange = null) {
    console.log(`Starting connection monitoring (interval: ${intervalMs}ms)...`);
    
    let lastStatus = null;
    
    const monitor = async () => {
      try {
        const result = await this.checkConnection();
        const currentStatus = result.connected ? 'connected' : 'disconnected';
        
        if (currentStatus !== lastStatus) {
          console.log(`Connection status changed: ${lastStatus} -> ${currentStatus}`);
          lastStatus = currentStatus;
          
          if (onStatusChange) {
            try {
              await onStatusChange(currentStatus, result);
            } catch (callbackError) {
              console.error('Error in status change callback:', callbackError.message);
            }
          }
        }
      } catch (error) {
        console.error('Error in connection monitoring:', error.message);
      }
    };
    
    // Initial check
    await monitor();
    
    // Set up interval
    const intervalId = setInterval(monitor, intervalMs);
    
    return {
      stop: () => {
        console.log('Stopping connection monitoring...');
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
      
      console.log(`Making ${method.toUpperCase()} request to:`, url);
      const response = await httpClient.request(config);
      
      console.log(`${method.toUpperCase()} request successful:`, response.status);
      return response;
    } catch (error) {
      console.error(`${method.toUpperCase()} request failed:`, error.message);
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
    console.log('Connection cache cleared');
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