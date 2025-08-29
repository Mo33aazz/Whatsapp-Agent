const fs = require('fs');
const path = require('path');

/**
 * Professional Logging Service
 * Provides structured logging with multiple levels: DEBUG, INFO, WARNING
 * Features: timestamps, colors, file output, context tracking
 */
class Logger {
  constructor() {
    this.levels = {
      DEBUG: { value: 0, color: '\x1b[36m', emoji: '🔍', name: 'DEBUG' },
      INFO: { value: 1, color: '\x1b[32m', emoji: '✅', name: 'INFO' },
      WARNING: { value: 2, color: '\x1b[33m', emoji: '⚠️', name: 'WARNING' },
      ERROR: { value: 3, color: '\x1b[31m', emoji: '❌', name: 'ERROR' }
    };
    
    this.currentLevel = this.levels.INFO; // Default to INFO level
    this.enableFileLogging = process.env.LOG_TO_FILE === 'true';
    this.enableColors = process.env.NO_COLOR !== 'true';
    this.logDir = path.join(process.cwd(), 'logs');
    this.logFile = path.join(this.logDir, `app-${new Date().toISOString().split('T')[0]}.log`);
    
    this._ensureLogDirectory();
  }

  /**
   * Set the minimum logging level
   * @param {string} level - DEBUG, INFO, WARNING, ERROR
   */
  setLevel(level) {
    const upperLevel = level.toUpperCase();
    if (this.levels[upperLevel]) {
      this.currentLevel = this.levels[upperLevel];
      this.info('Logger', `Log level set to ${upperLevel}`);
    } else {
      this.warning('Logger', `Invalid log level: ${level}. Using INFO.`);
    }
  }

  /**
   * Enable or disable file logging
   * @param {boolean} enabled
   */
  setFileLogging(enabled) {
    this.enableFileLogging = enabled;
    if (enabled) {
      this._ensureLogDirectory();
      this.info('Logger', 'File logging enabled');
    } else {
      this.info('Logger', 'File logging disabled');
    }
  }

  /**
   * Debug level logging - for detailed diagnostic information
   * @param {string} context - The context/module name
   * @param {string} message - The log message
   * @param {object} data - Optional additional data
   */
  debug(context, message, data = null) {
    this._log(this.levels.DEBUG, context, message, data);
  }

  /**
   * Info level logging - for general information
   * @param {string} context - The context/module name
   * @param {string} message - The log message
   * @param {object} data - Optional additional data
   */
  info(context, message, data = null) {
    this._log(this.levels.INFO, context, message, data);
  }

  /**
   * Warning level logging - for potentially harmful situations
   * @param {string} context - The context/module name
   * @param {string} message - The log message
   * @param {object} data - Optional additional data
   */
  warning(context, message, data = null) {
    this._log(this.levels.WARNING, context, message, data);
  }

  /**
   * Error level logging - for error events
   * @param {string} context - The context/module name
   * @param {string} message - The log message
   * @param {Error|object} error - Error object or additional data
   */
  error(context, message, error = null) {
    let errorData = null;
    if (error instanceof Error) {
      errorData = {
        message: error.message,
        stack: error.stack,
        name: error.name
      };
    } else if (error) {
      errorData = error;
    }
    this._log(this.levels.ERROR, context, message, errorData);
  }

  /**
   * Core logging method
   * @private
   */
  _log(level, context, message, data) {
    // Check if this level should be logged
    if (level.value < this.currentLevel.value) {
      return;
    }

    const timestamp = new Date().toISOString();
    const contextStr = context ? `[${context}]` : '';
    
    // Format the main log message
    let logMessage = `${timestamp} ${level.emoji} ${level.name} ${contextStr} ${message}`;
    
    // Add data if provided
    if (data) {
      const dataStr = typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data);
      logMessage += `\n${this._indent(dataStr, '  ')}`;
    }

    // Console output with colors
    if (this.enableColors) {
      console.log(`${level.color}${logMessage}\x1b[0m`);
    } else {
      console.log(logMessage);
    }

    // File output (without colors)
    if (this.enableFileLogging) {
      this._writeToFile(logMessage);
    }
  }

  /**
   * Indent multiline strings
   * @private
   */
  _indent(str, indent) {
    return str.split('\n').map(line => indent + line).join('\n');
  }

  /**
   * Write log to file
   * @private
   */
  _writeToFile(message) {
    try {
      const logEntry = message + '\n';
      fs.appendFileSync(this.logFile, logEntry, 'utf8');
    } catch (error) {
      // Fallback to console if file writing fails
      console.error('Failed to write to log file:', error.message);
    }
  }

  /**
   * Ensure log directory exists
   * @private
   */
  _ensureLogDirectory() {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch (error) {
      console.error('Failed to create log directory:', error.message);
      this.enableFileLogging = false;
    }
  }

  /**
   * Create a child logger with a specific context
   * @param {string} context - The context name
   * @returns {object} Child logger with context pre-filled
   */
  child(context) {
    return {
      debug: (message, data) => this.debug(context, message, data),
      info: (message, data) => this.info(context, message, data),
      warning: (message, data) => this.warning(context, message, data),
      error: (message, error) => this.error(context, message, error)
    };
  }

  /**
   * Get current log level
   */
  getLevel() {
    return this.currentLevel.name;
  }

  /**
   * Check if a level is enabled
   * @param {string} level
   */
  isLevelEnabled(level) {
    const upperLevel = level.toUpperCase();
    return this.levels[upperLevel] && this.levels[upperLevel].value >= this.currentLevel.value;
  }

  /**
   * Legacy compatibility methods
   */
  setEnabled(flag) {
    if (flag) {
      this.setLevel('DEBUG');
    } else {
      this.setLevel('INFO');
    }
  }

  isEnabled() {
    return this.currentLevel.value <= this.levels.DEBUG.value;
  }

  /**
   * Install console debug shim for backward compatibility
   */
  installConsoleDebugShim() {
    if (typeof console.debug !== 'function') {
      console.debug = (...args) => {
        if (this.isLevelEnabled('DEBUG')) {
          this.debug('Console', args.join(' '));
        }
      };
    }
  }
}

// Create and configure the global logger instance
const logger = new Logger();

// Set initial configuration from environment
if (process.env.LOG_LEVEL) {
  logger.setLevel(process.env.LOG_LEVEL);
}

if (process.env.LOG_TO_FILE === 'true') {
  logger.setFileLogging(true);
}

// Install console debug shim
logger.installConsoleDebugShim();

// Export both the logger instance and the class
module.exports = logger;
module.exports.Logger = Logger;
module.exports.createLogger = (context) => logger.child(context);

// Legacy exports for backward compatibility
module.exports.setEnabled = logger.setEnabled.bind(logger);
module.exports.isEnabled = logger.isEnabled.bind(logger);
// Ensure destructured `debug` works without causing recursion
// Use a bound function instead of wrapping to avoid self-calls
module.exports.debug = logger.debug.bind(logger);
module.exports.installConsoleDebugShim = logger.installConsoleDebugShim.bind(logger);

// Add warn alias for warning method
module.exports.warn = logger.warning.bind(logger);
