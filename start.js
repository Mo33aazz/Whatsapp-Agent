#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const logger = require('./utils/logger');

/**
 * Startup script for WhatsApp AI Bot
 * Checks dependencies and starts the server
 */

class BotStarter {
  constructor() {
    this.checks = {
      nodeVersion: false,
      dependencies: false,
      wahaConnection: false,
      environment: false
    };
  }

  /**
   * Main startup function
   */
  async start() {
    logger.info('Startup', '🤖 WhatsApp AI Bot Startup Script');
    logger.info('Startup', '==================================\n');

    try {
      await this.runPreflightChecks();
      await this.startServer();
    } catch (error) {
      logger.error('Startup', 'Startup failed', error);
      process.exit(1);
    }
  }

  /**
   * Run all preflight checks
   */
  async runPreflightChecks() {
    logger.info('Preflight', '🔍 Running preflight checks...\n');

    await this.checkNodeVersion();
    await this.checkDependencies();
    await this.checkEnvironment();
    await this.checkWahaConnection();

    logger.info('Preflight', '\n✅ All preflight checks passed!\n');
  }

  /**
   * Check Node.js version
   */
  async checkNodeVersion() {
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);

    if (majorVersion >= 18) {
      if (logger.isLevelEnabled('DEBUG')) {
        logger.info('NodeCheck', `✅ Node.js version: ${nodeVersion}`);
      }
      this.checks.nodeVersion = true;
    } else {
      throw new Error(`Node.js 18+ required, found ${nodeVersion}`);
    }
  }

  /**
   * Check if dependencies are installed
   */
  async checkDependencies() {
    const packageJsonPath = path.join(__dirname, 'package.json');
    const nodeModulesPath = path.join(__dirname, 'node_modules');

    if (!fs.existsSync(packageJsonPath)) {
      throw new Error('package.json not found');
    }

    if (!fs.existsSync(nodeModulesPath)) {
      logger.warning('Dependencies', '⚠️  Dependencies not installed, installing now...');
      await this.installDependencies();
    } else {
      if (logger.isLevelEnabled('DEBUG')) {
        logger.info('Dependencies', '✅ Dependencies installed');
      }
    }

    this.checks.dependencies = true;
  }

  /**
   * Install dependencies
   */
  async installDependencies() {
    return new Promise((resolve, reject) => {
      const npm = spawn('npm', ['install'], {
        stdio: 'inherit',
        shell: true
      });

      npm.on('close', (code) => {
        if (code === 0) {
          logger.info('Dependencies', '✅ Dependencies installed successfully');
          resolve();
        } else {
          reject(new Error(`npm install failed with code ${code}`));
        }
      });

      npm.on('error', (error) => {
        reject(new Error(`Failed to run npm install: ${error.message}`));
      });
    });
  }

  /**
   * Check environment configuration
   */
  async checkEnvironment() {
    const envPath = path.join(__dirname, '.env');

    if (!fs.existsSync(envPath)) {
      logger.warning('Environment', '⚠️  .env file not found, using default configuration');
    } else {
      if (logger.isLevelEnabled('DEBUG')) {
        logger.info('Environment', '✅ Environment file found');
      }
    }

    // Load environment variables
    require('dotenv').config();

    // Check required variables
    const required = ['WAHA_URL', 'WAHA_SESSION_NAME'];
    const missing = required.filter(key => !process.env[key]);

    if (missing.length > 0) {
      logger.warning('Environment', `⚠️  Missing environment variables: ${missing.join(', ')}`);
      logger.warning('Environment', '   Using default values where possible');
    } else {
      if (logger.isLevelEnabled('DEBUG')) {
        logger.info('Environment', '✅ Environment configuration valid');
      }
    }

    this.checks.environment = true;
  }

  /**
   * Check WAHA connection
   */
  async checkWahaConnection() {
    const wahaUrl = process.env.WAHA_URL || 'http://localhost:3000';

    try {
      // Use a stable JSON endpoint; /health returns 422 in some WAHA builds
      await this.makeHttpRequest(wahaUrl + '/api/sessions', 5000);
      if (logger.isLevelEnabled('DEBUG')) {
        logger.info('WAHA', '✅ WAHA server is running');
      }
      this.checks.wahaConnection = true;
    } catch (error) {
      logger.warning('WAHA', '⚠️  WAHA server not accessible');
      logger.warning('WAHA', `   Expected at: ${wahaUrl}`);
      logger.warning('WAHA', '   Please ensure WAHA is running before starting the bot');
      logger.warning('WAHA', '   You can start WAHA with: docker run -p 3000:3000 devlikeapro/waha');
      // Don't fail startup, just warn
    }
  }

  /**
   * Make HTTP request with timeout
   */
  makeHttpRequest(url, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const request = http.get(url, (response) => {
        resolve(response);
      });

      request.on('error', (error) => {
        reject(error);
      });

      request.setTimeout(timeout, () => {
        request.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }

  /**
   * Start the main server
   */
  async startServer() {
    logger.info('Server', '🚀 Starting WhatsApp AI Bot server...\n');

    const server = spawn('node', ['server.js'], {
      stdio: 'inherit',
      shell: true
    });

    server.on('error', (error) => {
      logger.error('Server', 'Failed to start server', error);
      process.exit(1);
    });

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      logger.info('Server', '\n🛑 Shutting down gracefully...');
      server.kill('SIGINT');
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      logger.info('Server', '\n🛑 Shutting down gracefully...');
      server.kill('SIGTERM');
      process.exit(0);
    });
  }

  /**
   * Print startup summary
   */
  printSummary() {
    logger.info('Summary', '\n📋 Startup Summary:');
    logger.info('Summary', '==================');
    Object.entries(this.checks).forEach(([check, passed]) => {
      logger.info('Summary', `${passed ? '✅' : '❌'} ${check}`);
    });
    logger.info('Summary', '');
  }
}

// Run if called directly
if (require.main === module) {
  const starter = new BotStarter();
  starter.start().catch((error) => {
    logger.error('Main', 'Startup failed', error);
    process.exit(1);
  });
}

module.exports = BotStarter;
