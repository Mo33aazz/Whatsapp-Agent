# WAHA Automatic Container Management Enhancement Plan

## Overview

This plan outlines the enhancements needed to implement automatic WAHA container management that will:
1. Automatically search for existing WAHA containers
2. Start stopped containers if they exist
3. Create new containers with the correct configuration if none exist
4. Use the proper Docker image name and environment variables
5. Integrate seamlessly with the existing preflight checks

## Current Issues

### 1. Incorrect Docker Image Name
- **Current**: `ghcr.io/devlikeapro/waha:latest`
- **Required**: `devlikeapro/waha`

### 2. Missing Environment Variable
- **Missing**: `-e WHATSAPP_DEFAULT_ENGINE=NOWEB`
- **Required**: This environment variable is needed for proper WAHA operation

### 3. Limited Preflight Integration
- **Current**: System shows warnings but doesn't automatically manage containers
- **Required**: Automatic container management during preflight checks

## Proposed Solution

### File: `utils/dockerManager.js` - Required Changes

#### 1. Update Docker Image Name
```javascript
// Line 15: Change from
this.imageName = 'ghcr.io/devlikeapro/waha:latest';
// To
this.imageName = 'devlikeapro/waha';
```

#### 2. Add Environment Variable Support
```javascript
// Add to constructor
this.environmentVariables = {
  WHATSAPP_DEFAULT_ENGINE: 'NOWEB'
};

// Update createAndStartContainer method
const dockerRunCommand = `docker run -d \\
  --name ${this.containerName} \\
  --restart unless-stopped \\
  -p ${this.port}:3000 \\
  -v waha-data:/app/data \\
  ${Object.entries(this.environmentVariables).map(([key, value]) => 
    `-e ${key}=${value}`).join(' ')} \\
  ${this.imageName}`;
```

#### 3. Enhanced Health Monitoring
```javascript
// Update checkContainerHealth method with better indicators
const readyIndicators = [
  'server listening on',
  'waha is ready',
  'application started',
  'express server started',
  'http server started',
  'waatsapp api server ready'
];
```

### File: `services/wahaInitializer.js` - Required Changes

#### 1. Enhanced Initialization Flow
```javascript
async initialize() {
  try {
    this.logger.info('Starting WAHA initialization sequence...');

    // Step 1: Check if WAHA is running
    const wahaRunning = await this.checkWahaConnection();
    
    if (!wahaRunning) {
      this.logger.info('WAHA not running, ensuring container is available...');
      this.containerStarted = await this.dockerManager.ensureContainerRunning();
      
      if (this.containerStarted) {
        this.logger.info('WAHA container started successfully');
      } else {
        throw new Error('Failed to start WAHA container');
      }
    } else {
      this.logger.info('WAHA already running, skipping container start');
      this.containerStarted = false;
    }

    // Continue with existing session management...
  } catch (error) {
    this.logger.error('WAHA initialization failed', error);
    throw error;
  }
}
```

### File: `server.js` - Required Changes

#### 1. Enhanced Preflight Integration
```javascript
// Add before the existing WAHA initialization
async function performWAHAPreflightCheck() {
  try {
    logger.info('Server', 'Performing WAHA preflight check...');
    
    const wahaInitializer = WAHAInitializer;
    const containerStatus = await wahaInitializer.dockerManager.getContainerStatus();
    
    logger.info('Server', 'WAHA Container Status:', {
      status: containerStatus.status,
      exists: containerStatus.exists,
      isRunning: containerStatus.isRunning
    });
    
    if (containerStatus.status === 'not-created') {
      logger.info('Server', 'WAHA container not found, will be created automatically');
    } else if (containerStatus.status === 'stopped') {
      logger.info('Server', 'WAHA container found but stopped, will be started automatically');
    } else if (containerStatus.status === 'running') {
      logger.info('Server', 'WAHA container is already running');
    }
    
    return containerStatus;
  } catch (error) {
    logger.error('Server', 'WAHA preflight check failed', error);
    return { status: 'error', error: error.message };
  }
}

// Update server startup to include preflight check
app.listen(PORT, async () => {
  logger.info('Server', `WhatsApp AI Bot server running on port ${PORT}`);
  
  try {
    // Perform WAHA preflight check
    const containerStatus = await performWAHAPreflightCheck();
    
    // Continue with existing initialization...
    const initResult = await wahaInitializer.initialize();
    
    if (initResult.success) {
      logger.info('Server', `WAHA initialization: Success`);
      logger.info('Server', `Container started: ${initResult.containerStarted ? 'Yes' : 'No'}`);
    }
  } catch (error) {
    logger.error('Server', 'WAHA initialization failed (non-fatal)', error);
  }
});
```

## Implementation Steps

### Phase 1: DockerManager Enhancements
1. Update Docker image name from `ghcr.io/devlikeapro/waha:latest` to `devlikeapro/waha`
2. Add `WHATSAPP_DEFAULT_ENGINE=NOWEB` environment variable to container creation
3. Enhance health monitoring with more specific WAHA startup indicators
4. Add better error handling and logging

### Phase 2: WAHAInitializer Integration
1. Update initialization flow to use enhanced DockerManager
2. Add automatic container management to preflight checks
3. Improve error recovery mechanisms
4. Add comprehensive logging for container operations

### Phase 3: Server Integration
1. Add preflight check functionality to server startup
2. Update server logging to include container status information
3. Ensure graceful handling of container management failures
4. Add user-friendly status messages

### Phase 4: Testing and Documentation
1. Create comprehensive test scenarios
2. Document the enhanced automatic container management
3. Add troubleshooting guide for common issues
4. Create migration guide for existing deployments

## Expected Benefits

1. **Automatic Container Management**: No manual intervention required for WAHA container
2. **Improved User Experience**: Clear status messages and automatic recovery
3. **Better Reliability**: Enhanced health monitoring and error handling
4. **Simplified Deployment**: One-command startup with automatic container management
5. **Reduced Maintenance**: Automatic container restart and recovery mechanisms

## Testing Scenarios

### Scenario 1: Fresh Installation
- No existing containers
- System should automatically create and start WAHA container
- Session should be properly configured

### Scenario 2: Container Exists but Stopped
- Container exists but is not running
- System should automatically start the existing container
- Session should be validated and configured

### Scenario 3: Container Already Running
- Container is already running and healthy
- System should skip container management and proceed with session validation
- No unnecessary container operations

### Scenario 4: Container Creation Failure
- Docker is not available or misconfigured
- System should provide clear error messages
- Application should continue with graceful degradation

### Scenario 5: Session Configuration Issues
- Container starts but session fails to configure
- System should retry with exponential backoff
- Should provide helpful error messages

## Rollout Plan

1. **Development Phase**: Implement changes in development environment
2. **Testing Phase**: Test all scenarios in staging environment
3. **Documentation Phase**: Update documentation and create guides
4. **Production Rollout**: Deploy to production with monitoring
5. **Monitoring Phase**: Monitor for any issues and adjust as needed

## Risk Assessment

### Low Risk
- Docker image name change
- Environment variable addition
- Enhanced logging

### Medium Risk
- Health monitoring changes
- Error handling modifications
- Preflight check integration

### Mitigation Strategies
- Comprehensive testing of all scenarios
- Graceful degradation for non-critical failures
- Clear error messages and logging
- Rollback plan for production issues

## Success Criteria

1. ✅ WAHA container starts automatically when needed
2. ✅ No manual intervention required for container management
3. ✅ Clear status messages for users
4. ✅ Proper error handling and recovery
5. ✅ Enhanced logging for troubleshooting
6. ✅ Backward compatibility maintained
7. ✅ Performance impact minimized