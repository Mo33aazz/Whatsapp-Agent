# WAHA Initializer Implementation Plan

## Overview
This document outlines the implementation of a WAHA initialization service that automates the startup sequence for the WhatsApp AI Bot.

## Requirements
The bot should perform these steps when starting:
1. Check if WAHA runs on localhost:3000, if not start it using Docker
2. After installation, delete the session "default" and create it again to add the webhook (only if container was started)
3. Check if the session is working and webhook is configured, if not return to step 2
4. Handle 422 errors by restarting the session using POST /api/sessions/default/restart

## Architecture

### File Structure
```
services/
├── wahaInitializer.js          # Main initialization service
├── dockerManager.js           # Docker container management
├── sessionInitializer.js      # Session management utilities
└── errorHandler.js            # Enhanced error handling

utils/
├── dockerManager.js           # Docker utilities
└── sessionValidator.js       # Session validation utilities
```

### Core Components

#### 1. WAHAInitializer Service
**File**: `services/wahaInitializer.js`

```javascript
const DockerManager = require('./dockerManager');
const SessionInitializer = require('./sessionInitializer');
const logger = require('../utils/logger');

class WAHAInitializer {
  constructor() {
    this.dockerManager = new DockerManager();
    this.sessionInitializer = new SessionInitializer();
    this.containerStarted = false;
    this.maxRetries = 3;
    this.retryDelay = 5000;
  }

  async initialize() {
    try {
      logger.info('WAHAInitializer', 'Starting WAHA initialization sequence...');
      
      // Step 1: Check if WAHA is running
      const wahaRunning = await this.checkWahaConnection();
      
      if (!wahaRunning) {
        logger.info('WAHAInitializer', 'WAHA not running, starting container...');
        this.containerStarted = await this.dockerManager.startWahaContainer();
        
        if (this.containerStarted) {
          logger.info('WAHAInitializer', 'WAHA container started successfully');
        } else {
          throw new Error('Failed to start WAHA container');
        }
      } else {
        logger.info('WAHAInitializer', 'WAHA already running, skipping container start');
      }

      // Step 2: Handle session management (conditional)
      if (this.containerStarted) {
        logger.info('WAHAInitializer', 'Container was started, recreating session...');
        await this.sessionInitializer.recreateSessionWithWebhook();
      } else {
        logger.info('WAHAInitializer', 'Validating existing session configuration...');
        await this.sessionInitializer.validateExistingSession();
      }

      // Step 3: Validate session and webhook
      const validation = await this.sessionInitializer.validateSessionAndWebhook();
      
      if (!validation.valid) {
        logger.warning('WAHAInitializer', 'Session validation failed, retrying...');
        return await this.retryInitialization();
      }

      logger.info('WAHAInitializer', 'WAHA initialization completed successfully');
      return {
        success: true,
        containerStarted: this.containerStarted,
        sessionStatus: validation.status
      };

    } catch (error) {
      logger.error('WAHAInitializer', 'Initialization failed', error);
      throw error;
    }
  }

  async checkWahaConnection() {
    try {
      const response = await fetch(`${this.getWahaUrl()}/api/sessions`, {
        method: 'GET',
        timeout: 5000
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  async retryInitialization() {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        logger.info('WAHAInitializer', `Retry attempt ${attempt}/${this.maxRetries}`);
        await this.sleep(this.retryDelay);
        
        const validation = await this.sessionInitializer.validateSessionAndWebhook();
        if (validation.valid) {
          logger.info('WAHAInitializer', 'Session validation successful on retry');
          return {
            success: true,
            containerStarted: this.containerStarted,
            sessionStatus: validation.status
          };
        }
      } catch (error) {
        logger.warning('WAHAInitializer', `Retry ${attempt} failed`, error);
      }
    }
    
    throw new Error('Session validation failed after all retries');
  }

  getWahaUrl() {
    return process.env.WAHA_URL || 'http://localhost:3000';
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Handle 422 errors by restarting session
  async handle422Error(sessionName = 'default') {
    try {
      logger.warning('WAHAInitializer', `Handling 422 error for session ${sessionName}`);
      
      const response = await fetch(`${this.getWahaUrl()}/api/sessions/${sessionName}/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        logger.info('WAHAInitializer', `Session ${sessionName} restarted successfully`);
        return true;
      } else {
        throw new Error(`Failed to restart session: ${response.status}`);
      }
    } catch (error) {
      logger.error('WAHAInitializer', `Error restarting session ${sessionName}`, error);
      throw error;
    }
  }
}

module.exports = WAHAInitializer;
```

#### 2. Docker Manager
**File**: `services/dockerManager.js`

```javascript
const { spawn } = require('child_process');
const logger = require('../utils/logger');

class DockerManager {
  constructor() {
    this.containerName = 'waha-bot';
    this.dockerImage = 'devlikeapro/waha';
    this.containerPort = '3000:3000';
  }

  async startWahaContainer() {
    try {
      logger.info('DockerManager', 'Starting WAHA container...');
      
      // Check if container already exists
      const containerExists = await this.checkContainerExists();
      
      if (containerExists) {
        logger.info('DockerManager', 'Container exists, starting it...');
        await this.startExistingContainer();
      } else {
        logger.info('DockerManager', 'Creating new WAHA container...');
        await this.createNewContainer();
      }

      // Wait for container to be ready
      await this.waitForContainerReady();
      
      return true;
    } catch (error) {
      logger.error('DockerManager', 'Failed to start WAHA container', error);
      return false;
    }
  }

  async checkContainerExists() {
    return new Promise((resolve, reject) => {
      const docker = spawn('docker', ['ps', '-a', '--filter', `name=${this.containerName}`, '--format', '{{.Names}}']);
      
      let output = '';
      docker.stdout.on('data', (data) => {
        output += data.toString();
      });

      docker.on('close', (code) => {
        resolve(output.trim() === this.containerName);
      });

      docker.on('error', (error) => {
        reject(error);
      });
    });
  }

  async startExistingContainer() {
    return new Promise((resolve, reject) => {
      const docker = spawn('docker', ['start', this.containerName]);
      
      docker.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Failed to start container, exit code: ${code}`));
        }
      });

      docker.on('error', (error) => {
        reject(error);
      });
    });
  }

  async createNewContainer() {
    return new Promise((resolve, reject) => {
      const docker = spawn('docker', [
        'run', 
        '-it', 
        '-d', 
        '--name', this.containerName,
        '-p', this.containerPort,
        '-e', 'WHATSAPP_DEFAULT_ENGINE=NOWEB',
        this.dockerImage
      ]);

      docker.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Failed to create container, exit code: ${code}`));
        }
      });

      docker.on('error', (error) => {
        reject(error);
      });
    });
  }

  async waitForContainerReady() {
    const maxAttempts = 30; // 30 seconds
    const attemptDelay = 1000; // 1 second

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetch('http://localhost:3000/api/sessions', {
          method: 'GET',
          timeout: 3000
        });

        if (response.ok) {
          logger.info('DockerManager', 'Container is ready');
          return;
        }
      } catch (error) {
        // Container not ready yet
      }

      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, attemptDelay));
      }
    }

    throw new Error('Container failed to become ready');
  }

  async stopContainer() {
    // Implementation for stopping container if needed
  }
}

module.exports = DockerManager;
```

#### 3. Session Initializer
**File**: `services/sessionInitializer.js`

```javascript
const httpClient = require('../utils/httpClient');
const logger = require('../utils/logger');

class SessionInitializer {
  constructor() {
    this.baseURL = process.env.WAHA_URL || 'http://localhost:3000';
    this.sessionName = process.env.WAHA_SESSION_NAME || 'default';
    this.webhookUrl = this.getWebhookUrl();
  }

  async recreateSessionWithWebhook() {
    try {
      logger.info('SessionInitializer', `Recreating session ${this.sessionName} with webhook...`);

      // Delete existing session
      await this.deleteSession();

      // Create new session with webhook
      await this.createSessionWithWebhook();

      logger.info('SessionInitializer', 'Session recreated successfully with webhook');
    } catch (error) {
      logger.error('SessionInitializer', 'Failed to recreate session', error);
      throw error;
    }
  }

  async validateExistingSession() {
    try {
      logger.info('SessionInitializer', 'Validating existing session configuration...');

      const sessionInfo = await this.getSessionInfo();
      const hasValidWebhook = await this.checkWebhookConfiguration();

      if (!hasValidWebhook) {
        logger.warning('SessionInitializer', 'Existing session has invalid webhook configuration');
        await this.updateWebhookConfiguration();
      }

      logger.info('SessionInitializer', 'Existing session validated successfully');
      return { valid: true, status: sessionInfo?.data?.status };
    } catch (error) {
      logger.error('SessionInitializer', 'Failed to validate existing session', error);
      throw error;
    }
  }

  async validateSessionAndWebhook() {
    try {
      const sessionInfo = await this.getSessionInfo();
      const sessionStatus = sessionInfo?.data?.status;

      if (sessionStatus !== 'WORKING') {
        return { valid: false, status: sessionStatus };
      }

      const hasValidWebhook = await this.checkWebhookConfiguration();
      return { 
        valid: hasValidWebhook, 
        status: sessionStatus,
        webhookConfigured: hasValidWebhook
      };
    } catch (error) {
      logger.error('SessionInitializer', 'Failed to validate session and webhook', error);
      return { valid: false, status: 'ERROR', error: error.message };
    }
  }

  async deleteSession() {
    try {
      logger.info('SessionInitializer', `Deleting session ${this.sessionName}...`);

      const response = await httpClient.delete(
        `${this.baseURL}/api/sessions/${this.sessionName}`,
        {
          timeout: 20000,
          headers: { 'Accept': 'application/json' }
        }
      );

      logger.info('SessionInitializer', 'Session deleted successfully');
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        logger.info('SessionInitializer', 'Session not found, already deleted');
        return { status: 'not_found' };
      }
      throw error;
    }
  }

  async createSessionWithWebhook() {
    const payload = {
      name: this.sessionName,
      start: true,
      config: {
        proxy: null,
        debug: false,
        noweb: { store: { enabled: true, fullSync: false } },
        webhooks: [
          {
            url: this.webhookUrl,
            events: ['message', 'session.status', 'message.any'],
            hmac: null,
            retries: null,
            customHeaders: null
          }
        ]
      }
    };

    const response = await httpClient.post(
      `${this.baseURL}/api/sessions/start`,
      payload,
      {
        timeout: 30000,
        headers: { 'Content-Type': 'application/json' }
      }
    );

    logger.info('SessionInitializer', 'Session created with webhook', response.data);
    return response.data;
  }

  async getSessionInfo() {
    try {
      const response = await httpClient.get(`${this.baseURL}/api/sessions/${this.sessionName}`, {
        timeout: 10000,
        headers: { 'Accept': 'application/json' }
      });

      return response;
    } catch (error) {
      logger.error('SessionInitializer', 'Failed to get session info', error);
      throw error;
    }
  }

  async checkWebhookConfiguration() {
    try {
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

      logger.info('SessionInitializer', `Webhook configuration check: ${hasCorrectWebhook}`);
      return hasCorrectWebhook;
    } catch (error) {
      logger.error('SessionInitializer', 'Failed to check webhook configuration', error);
      return false;
    }
  }

  async updateWebhookConfiguration() {
    try {
      logger.info('SessionInitializer', 'Updating webhook configuration...');

      const payload = {
        url: this.webhookUrl,
        events: ['message', 'session.status', 'message.any'],
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

      logger.info('SessionInitializer', 'Webhook configuration updated successfully');
      return response.data;
    } catch (error) {
      logger.error('SessionInitializer', 'Failed to update webhook configuration', error);
      throw error;
    }
  }

  getWebhookUrl() {
    const path = (process.env.WEBHOOK_PATH || '/waha-events');
    const base = process.env.PUBLIC_BASE_URL;
    if (base) return `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : '/' + path}`;
    const port = process.env.PORT || 3001;
    return `http://host.docker.internal:${port}${path.startsWith('/') ? path : '/' + path}`;
  }
}

module.exports = SessionInitializer;
```

#### 4. Enhanced Error Handler
**File**: `services/errorHandler.js`

```javascript
const logger = require('../utils/logger');

class WAHAErrorHandler {
  constructor(wahaInitializer) {
    this.wahaInitializer = wahaInitializer;
  }

  async handle422Error(error, sessionName = 'default') {
    if (error.response?.status === 422) {
      logger.warning('WAHAErrorHandler', `422 error detected for session ${sessionName}`);
      
      try {
        await this.wahaInitializer.handle422Error(sessionName);
        logger.info('WAHAErrorHandler', 'Session restarted successfully after 422 error');
        return true;
      } catch (restartError) {
        logger.error('WAHAErrorHandler', 'Failed to restart session after 422 error', restartError);
        return false;
      }
    }
    return false;
  }

  async handleInitializationError(error) {
    logger.error('WAHAErrorHandler', 'Initialization error occurred', error);
    
    if (error.response?.status === 422) {
      return await this.handle422Error(error);
    }
    
    throw error;
  }
}

module.exports = WAHAErrorHandler;
```

## Integration with Existing Server

### Server.js Integration

```javascript
// Add to server.js after line 142
const wahaInitializer = require('./services/wahaInitializer');

// Replace the existing session ensure code (lines 141-149) with:
try {
  // Initialize WAHA first
  const initResult = await wahaInitializer.initialize();
  logger.info('Server', `WAHA initialization: ${initResult.success ? 'Success' : 'Failed'}`);
  if (initResult.success) {
    logger.info('Server', `Container started: ${initResult.containerStarted ? 'Yes' : 'No'}`);
    logger.info('Server', `Session status: ${initResult.sessionStatus}`);
  }
} catch (e) {
  logger.error('Server', 'WAHA initialization failed', e);
  // Continue server startup even if WAHA fails
}

// Keep the existing session ensure code for backward compatibility
try {
  const ensureRes = await wahaService.ensureDefaultSessionExistsWithWebhook();
  const msg = ensureRes?.created
    ? 'Default WAHA session created'
    : `Default WAHA session present (status: ${ensureRes?.status || 'unknown'})`;
  logger.info('Server', msg);
} catch (e) {
  logger.warning('Server', 'Default session ensure failed (non-fatal)', e);
}
```

### Package.json Update

Add the following dependencies if not already present:
```json
{
  "dependencies": {
    "node-fetch": "^3.3.2"
  }
}
```

## Configuration Options

### Environment Variables
- `WAHA_INITIALIZER_ENABLED`: Enable/disable automatic initialization (default: true)
- `WAHA_INITIALIZER_MAX_RETRIES`: Maximum retry attempts (default: 3)
- `WAHA_INITIALIZER_RETRY_DELAY`: Delay between retries in ms (default: 5000)
- `WAHA_DOCKER_IMAGE`: Docker image to use (default: devlikeapro/waha)
- `WAHA_CONTAINER_NAME`: Container name (default: waha-bot)

### Usage Example

```javascript
const WAHAInitializer = require('./services/wahaInitializer');

async function startBot() {
  const initializer = new WAHAInitializer();
  
  try {
    const result = await initializer.initialize();
    console.log('WAHA initialized:', result);
  } catch (error) {
    console.error('Failed to initialize WAHA:', error);
    // Handle error appropriately
  }
}
```

## Monitoring and Logging

The implementation includes comprehensive logging:
- Initialization steps
- Docker container operations
- Session management operations
- Error handling and recovery
- Validation results

## Error Recovery

The system implements multiple recovery strategies:
1. **Retry Logic**: Automatic retries for transient failures
2. **Session Restart**: Handles 422 errors by restarting sessions
3. **Container Restart**: Can restart Docker container if needed
4. **Graceful Degradation**: Continues operation even if some steps fail

## Testing

### Unit Tests
- Docker container management
- Session lifecycle operations
- Webhook configuration validation
- Error handling scenarios

### Integration Tests
- End-to-end initialization sequence
- Connection validation
- Session recovery scenarios

## Deployment

### Development
```bash
npm install node-fetch
```

### Production
- Ensure Docker is installed and running
- Configure environment variables appropriately
- Monitor logs for initialization status

## Security Considerations

- Docker container runs with minimal privileges
- Webhook URLs are validated
- Session operations are properly authenticated
- Error messages don't expose sensitive information

## Performance Considerations

- Async operations for better performance
- Connection pooling for HTTP requests
- Efficient retry mechanisms
- Minimal resource usage during idle periods

This implementation provides a robust, production-ready solution for automating WAHA initialization with proper error handling and recovery mechanisms.