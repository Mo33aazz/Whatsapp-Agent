const { exec } = require('child_process');
const { promisify } = require('util');
const logger = require('./logger');

const execAsync = promisify(exec);

/**
 * DockerManager utility class for WAHA container lifecycle management
 * Handles container creation, startup, health monitoring, and error handling
 */
class DockerManager {
  constructor() {
    this.logger = logger.child('DockerManager');
    this.containerName = 'waha';
    this.imageName = 'ghcr.io/devlikeapro/waha:latest';
    this.port = 3000;
    this.healthCheckInterval = 5000; // 5 seconds
    this.maxHealthCheckAttempts = 30; // 30 attempts = 2.5 minutes max wait
  }

  /**
   * Check if a WAHA container already exists
   * @returns {Promise<boolean>} True if container exists, false otherwise
   */
  async containerExists() {
    try {
      this.logger.debug('Checking if container exists', { containerName: this.containerName });
      
      const { stdout } = await execAsync(`docker ps -a --filter "name=${this.containerName}" --format "{{.Names}}"`);
      
      const exists = stdout.trim() === this.containerName;
      this.logger.info('Container existence check', { 
        containerName: this.containerName, 
        exists 
      });
      
      return exists;
    } catch (error) {
      this.logger.error('Failed to check container existence', error);
      throw new Error(`Failed to check container existence: ${error.message}`);
    }
  }

  /**
   * Check if container is running
   * @returns {Promise<boolean>} True if container is running, false otherwise
   */
  async isContainerRunning() {
    try {
      this.logger.debug('Checking if container is running', { containerName: this.containerName });
      
      const { stdout } = await execAsync(`docker ps --filter "name=${this.containerName}" --format "{{.Names}}"`);
      
      const isRunning = stdout.trim() === this.containerName;
      this.logger.info('Container running status', { 
        containerName: this.containerName, 
        isRunning 
      });
      
      return isRunning;
    } catch (error) {
      this.logger.error('Failed to check container running status', error);
      throw new Error(`Failed to check container running status: ${error.message}`);
    }
  }

  /**
   * Create and start a new WAHA container
   * @returns {Promise<void>}
   */
  async createAndStartContainer() {
    try {
      this.logger.info('Creating and starting WAHA container', { 
        containerName: this.containerName,
        imageName: this.imageName,
        port: this.port
      });

      const dockerRunCommand = `docker run -d \\
        --name ${this.containerName} \\
        --restart unless-stopped \\
        -p ${this.port}:3000 \\
        -v waha-data:/app/data \\
        ${this.imageName}`;

      this.logger.debug('Executing docker run command', { command: dockerRunCommand });

      const { stdout, stderr } = await execAsync(dockerRunCommand);

      if (stderr && stderr.trim()) {
        this.logger.warning('Docker run command produced stderr output', { stderr });
      }

      this.logger.info('Container created and started successfully', { 
        containerId: stdout.trim(),
        containerName: this.containerName
      });

      // Wait for container to be ready
      await this.waitForContainerReady();
    } catch (error) {
      this.logger.error('Failed to create and start container', error);
      throw new Error(`Failed to create and start container: ${error.message}`);
    }
  }

  /**
   * Start an existing container
   * @returns {Promise<void>}
   */
  async startExistingContainer() {
    try {
      this.logger.info('Starting existing WAHA container', { containerName: this.containerName });

      const { stdout, stderr } = await execAsync(`docker start ${this.containerName}`);

      if (stderr && stderr.trim()) {
        this.logger.warning('Docker start command produced stderr output', { stderr });
      }

      this.logger.info('Container started successfully', { 
        containerName: this.containerName,
        output: stdout.trim()
      });

      // Wait for container to be ready
      await this.waitForContainerReady();
    } catch (error) {
      this.logger.error('Failed to start existing container', error);
      throw new Error(`Failed to start existing container: ${error.message}`);
    }
  }

  /**
   * Wait for container to become ready
   * @returns {Promise<void>}
   */
  async waitForContainerReady() {
    this.logger.info('Waiting for container to become ready', { 
      containerName: this.containerName,
      maxAttempts: this.maxHealthCheckAttempts,
      interval: this.healthCheckInterval
    });

    let attempts = 0;
    
    while (attempts < this.maxHealthCheckAttempts) {
      try {
        attempts++;
        
        // Check if container is still running
        const isRunning = await this.isContainerRunning();
        if (!isRunning) {
          throw new Error('Container is not running');
        }

        // Check container health
        const isHealthy = await this.checkContainerHealth();
        
        if (isHealthy) {
          this.logger.info('Container is ready', { 
            containerName: this.containerName,
            attempts
          });
          return;
        }

        this.logger.debug('Container not yet ready, waiting...', { 
          containerName: this.containerName,
          attempt: attempts,
          maxAttempts: this.maxHealthCheckAttempts
        });

        // Wait before next check
        await new Promise(resolve => setTimeout(resolve, this.healthCheckInterval));
      } catch (error) {
        this.logger.warning('Health check failed, retrying...', { 
          containerName: this.containerName,
          attempt: attempts,
          error: error.message
        });

        if (attempts >= this.maxHealthCheckAttempts) {
          throw new Error(`Container did not become ready after ${this.maxHealthCheckAttempts} attempts: ${error.message}`);
        }

        await new Promise(resolve => setTimeout(resolve, this.healthCheckInterval));
      }
    }

    throw new Error(`Container health check timed out after ${this.maxHealthCheckAttempts} attempts`);
  }

  /**
   * Check container health status
   * @returns {Promise<boolean>} True if container is healthy, false otherwise
   */
  async checkContainerHealth() {
    try {
      // Check container logs for startup completion indicators
      const { stdout } = await execAsync(`docker logs --tail 20 ${this.containerName}`);
      
      // Look for indicators that the container is ready
      const readyIndicators = [
        'Server listening on',
        'WAHA is ready',
        'Application started',
        'Express server started'
      ];

      const isReady = readyIndicators.some(indicator => 
        stdout.toLowerCase().includes(indicator.toLowerCase())
      );

      if (isReady) {
        this.logger.debug('Container health check passed', { containerName: this.containerName });
        return true;
      }

      this.logger.debug('Container health check waiting for ready indicators', { 
        containerName: this.containerName,
        recentLogs: stdout
      });

      return false;
    } catch (error) {
      this.logger.error('Failed to check container health', error);
      return false;
    }
  }

  /**
   * Ensure container is running, start existing or create new if needed
   * @returns {Promise<void>}
   */
  async ensureContainerRunning() {
    try {
      this.logger.info('Ensuring WAHA container is running', { containerName: this.containerName });

      const exists = await this.containerExists();
      
      if (!exists) {
        this.logger.info('Container does not exist, creating new container', { containerName: this.containerName });
        await this.createAndStartContainer();
        return;
      }

      const isRunning = await this.isContainerRunning();
      
      if (isRunning) {
        this.logger.info('Container is already running', { containerName: this.containerName });
        await this.waitForContainerReady();
        return;
      }

      this.logger.info('Container exists but is not running, starting container', { containerName: this.containerName });
      await this.startExistingContainer();
    } catch (error) {
      this.logger.error('Failed to ensure container is running', error);
      throw new Error(`Failed to ensure container is running: ${error.message}`);
    }
  }

  /**
   * Stop the WAHA container
   * @returns {Promise<void>}
   */
  async stopContainer() {
    try {
      this.logger.info('Stopping WAHA container', { containerName: this.containerName });

      const { stdout, stderr } = await execAsync(`docker stop ${this.containerName}`);

      if (stderr && stderr.trim()) {
        this.logger.warning('Docker stop command produced stderr output', { stderr });
      }

      this.logger.info('Container stopped successfully', { 
        containerName: this.containerName,
        output: stdout.trim()
      });
    } catch (error) {
      this.logger.error('Failed to stop container', error);
      throw new Error(`Failed to stop container: ${error.message}`);
    }
  }

  /**
   * Remove the WAHA container
   * @returns {Promise<void>}
   */
  async removeContainer() {
    try {
      this.logger.info('Removing WAHA container', { containerName: this.containerName });

      const { stdout, stderr } = await execAsync(`docker rm -f ${this.containerName}`);

      if (stderr && stderr.trim()) {
        this.logger.warning('Docker rm command produced stderr output', { stderr });
      }

      this.logger.info('Container removed successfully', { 
        containerName: this.containerName,
        output: stdout.trim()
      });
    } catch (error) {
      this.logger.error('Failed to remove container', error);
      throw new Error(`Failed to remove container: ${error.message}`);
    }
  }

  /**
   * Get container status information
   * @returns {Promise<object>} Container status information
   */
  async getContainerStatus() {
    try {
      const exists = await this.containerExists();
      const isRunning = await this.isContainerRunning();
      
      let status = 'unknown';
      if (!exists) {
        status = 'not-created';
      } else if (isRunning) {
        status = 'running';
      } else {
        status = 'stopped';
      }

      // Get container details
      let containerInfo = {};
      try {
        const { stdout } = await execAsync(`docker inspect ${this.containerName} --format '{{json .}}'`);
        containerInfo = JSON.parse(stdout);
      } catch (error) {
        this.logger.warning('Failed to get container inspect info', error);
      }

      return {
        status,
        exists,
        isRunning,
        containerName: this.containerName,
        imageName: this.imageName,
        port: this.port,
        containerInfo: containerInfo[0] || null
      };
    } catch (error) {
      this.logger.error('Failed to get container status', error);
      throw new Error(`Failed to get container status: ${error.message}`);
    }
  }

  /**
   * Execute a Docker command with error handling
   * @param {string} command - The Docker command to execute
   * @returns {Promise<{stdout: string, stderr: string}>} Command execution result
   */
  async executeDockerCommand(command) {
    try {
      this.logger.debug('Executing Docker command', { command });

      const { stdout, stderr } = await execAsync(command);

      if (stderr && stderr.trim()) {
        this.logger.warning('Docker command produced stderr output', { 
          command, 
          stderr 
        });
      }

      this.logger.debug('Docker command executed successfully', { 
        command, 
        stdout: stdout.trim()
      });

      return { stdout, stderr };
    } catch (error) {
      this.logger.error('Docker command execution failed', { 
        command, 
        error: error.message 
      });
      throw new Error(`Docker command failed: ${error.message}`);
    }
  }
}

// Export singleton instance for consistency
module.exports = new DockerManager();