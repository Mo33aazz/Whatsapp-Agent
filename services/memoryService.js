const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

// Module-level write buffer map to avoid 'this' binding issues
const WRITE_BUFFERS = new Map();

class MemoryService {
  constructor() {
    this.dataDir = path.join(__dirname, '..', 'data');
    this.configFile = path.join(this.dataDir, 'config.json');
    this.conversationsFile = path.join(this.dataDir, 'conversations.json');
    this.statusFile = path.join(this.dataDir, 'status.json');
    // Append-only global message log (JSON Lines) for permanent storage
    this.messagesLogFile = process.env.MEMORY_LOG_FILE_PATH
      ? (path.isAbsolute(process.env.MEMORY_LOG_FILE_PATH)
          ? process.env.MEMORY_LOG_FILE_PATH
          : path.join(this.dataDir, path.basename(process.env.MEMORY_LOG_FILE_PATH)))
      : path.join(this.dataDir, 'messages.jsonl');
    
    this.cache = {
      config: null,
      conversations: null,
      status: null
    };
  }

  /**
   * Initialize the memory service and create necessary directories/files
   */
  async initialize() {
    try {
      // Create data directory if it doesn't exist
      await fs.mkdir(this.dataDir, { recursive: true });
      
      // Get default config with environment variable fallbacks
      const defaultConfig = this.getDefaultConfigWithEnvFallbacks();
      
      // Initialize files if they don't exist
      await this.ensureFileExists(this.configFile, defaultConfig);
      
      // Sync existing config with environment variables
      await this.syncConfigWithEnvironment();
      
      await this.ensureFileExists(this.conversationsFile, {});
      // Migrate/sanitize conversations file if it has an unexpected shape
      await this.migrateConversationsFileIfNeeded();
      
      await this.ensureFileExists(this.statusFile, {
        wahaConnected: false,
        openrouterConfigured: false,
        messagesProcessed: 0,
        lastMessageAt: null,
        uptime: '0h 0m',
        errors: []
      });

      // Ensure permanent message log exists (JSONL)
      await this.ensureFileExistsPlain(this.messagesLogFile, '');
      
      logger.info('Memory', 'Memory service initialized successfully');
    } catch (error) {
      logger.error('Error initializing memory service', 'Memory', { error: error.message });
      throw error;
    }
  }

  /**
   * Ensure conversations storage has the expected object-map shape.
   * Converts legacy/invalid array formats to an object keyed by userId.
   */
  async migrateConversationsFileIfNeeded() {
    try {
      const data = await this.readJsonFile(this.conversationsFile);
      // If already an object (and not null/array), nothing to do
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        return;
      }

      let migrated = {};
      if (Array.isArray(data)) {
        // Attempt to migrate an array of conversation objects into a map
        for (const item of data) {
          if (!item || typeof item !== 'object') continue;
          const userId = item.userId || item.chatId || item.contact || item.phone || item.id;
          if (!userId) continue;
          migrated[userId] = {
            sessionId: item.sessionId || 'default',
            messages: Array.isArray(item.messages) ? item.messages : (Array.isArray(item.history) ? item.history : []),
            createdAt: item.createdAt || new Date().toISOString(),
            updatedAt: item.updatedAt || new Date().toISOString()
          };
        }
      }

      // If migration produced an empty object or source was invalid, normalize to {}
      if (!migrated || typeof migrated !== 'object' || Array.isArray(migrated)) {
        migrated = {};
      }

      await this.writeJsonFile(this.conversationsFile, migrated);
      this.cache.conversations = migrated;
      logger.info('Memory', 'Conversations storage normalized to object-map format');
    } catch (err) {
      logger.warn('Memory', 'Conversations file migration check failed', { error: err.message });
    }
  }

  /**
   * Get default configuration with environment variable fallbacks
   * @returns {Object} Default configuration object
   */
  getDefaultConfigWithEnvFallbacks() {
    return {
      openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
      aiModel: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
      systemPrompt: process.env.SYSTEM_PROMPT || 'You are a helpful WhatsApp assistant.',
      wahaBaseUrl: process.env.WAHA_URL || 'http://localhost:3000',
      // Default to WAHA events webhook URL pointing to host.docker.internal
      webhookUrl: process.env.WEBHOOK_URL || 'http://host.docker.internal:3001/waha-events',
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Sync existing config.json with environment variables
   * This ensures that environment variables take precedence over empty config values
   */
  async syncConfigWithEnvironment() {
    try {
      const existingConfig = await this.readJsonFile(this.configFile);
      const envConfig = this.getDefaultConfigWithEnvFallbacks();
      let configUpdated = false;
      
      // Only update config values that are empty/missing and have env values
      const updatedConfig = { ...existingConfig };
      
      // Sync OpenRouter API key if it's empty in config but exists in env
      if ((!existingConfig.openrouterApiKey || existingConfig.openrouterApiKey === '') && envConfig.openrouterApiKey) {
        updatedConfig.openrouterApiKey = envConfig.openrouterApiKey;
        configUpdated = true;
        logger.info('Memory', 'Synced OpenRouter API key from environment variables');
      }
      
      // Sync other values if they're missing
      if (!existingConfig.aiModel && envConfig.aiModel) {
        updatedConfig.aiModel = envConfig.aiModel;
        configUpdated = true;
      }
      
      if (!existingConfig.systemPrompt && envConfig.systemPrompt) {
        updatedConfig.systemPrompt = envConfig.systemPrompt;
        configUpdated = true;
      }
      
      if (!existingConfig.wahaBaseUrl && envConfig.wahaBaseUrl) {
        updatedConfig.wahaBaseUrl = envConfig.wahaBaseUrl;
        configUpdated = true;
      }
      
      // Update lastUpdated timestamp if any changes were made
      if (configUpdated) {
        updatedConfig.lastUpdated = new Date().toISOString();
        await this.writeJsonFile(this.configFile, updatedConfig);
        // Clear cache to force reload
        this.cache.config = null;
        logger.info('Memory', 'Configuration synchronized with environment variables');
      }
    } catch (error) {
      logger.error('Error syncing config with environment', 'Config', { error: error.message });
      // Don't throw error here to avoid breaking initialization
    }
  }

  /**
   * Ensure a file exists with default content
   * @param {string} filePath - Path to the file
   * @param {Object} defaultContent - Default content if file doesn't exist
   */
  async ensureFileExists(filePath, defaultContent) {
    try {
      await fs.access(filePath);
    } catch (error) {
      // File doesn't exist, create it
      await fs.writeFile(filePath, JSON.stringify(defaultContent, null, 2));
    }
  }

  /**
   * Ensure a plain text file exists (used for JSONL log)
   * @param {string} filePath
   * @param {string} initialContent
   */
  async ensureFileExistsPlain(filePath, initialContent = '') {
    try {
      await fs.access(filePath);
    } catch (_) {
      await fs.writeFile(filePath, initialContent);
    }
  }

  /**
   * Schedule a debounced write to a JSON file to reduce I/O churn
   * @param {string} filePath
   * @param {Object} data
   * @param {number} delayMs
   */
  _scheduleWrite(filePath, data, delayMs = 200) {
    // Always use module-level buffer map to ensure availability
    let entry = WRITE_BUFFERS.get(filePath);
    if (!entry) {
      entry = { timer: null, inFlight: false, pending: false, data: null };
      WRITE_BUFFERS.set(filePath, entry);
    }
    entry.data = data;
    entry.pending = true;

    const flush = async () => {
      if (entry.inFlight) return;
      entry.inFlight = true;
      entry.pending = false;
      const payload = entry.data;
      try {
        await fs.writeFile(filePath, JSON.stringify(payload, null, 2));
      } catch (err) {
        logger.error(`Buffered write failed for ${filePath}`, 'Buffer', { filePath, error: err.message });
      } finally {
        entry.inFlight = false;
        if (entry.pending) {
          setTimeout(flush, 0);
        }
      }
    };

    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(flush, delayMs);
  }

  /**
   * Read and parse JSON file
   * @param {string} filePath - Path to the JSON file
   * @returns {Promise<Object>} Parsed JSON content
   */
  async readJsonFile(filePath) {
    try {
      const data = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(data);
      return parsed === null ? {} : parsed;
    } catch (error) {
      logger.error(`Error reading JSON file ${filePath}`, 'File', { filePath, error: error.message });
      return {};
    }
  }

  /**
   * Write JSON data to file
   * @param {string} filePath - Path to the JSON file
   * @param {Object} data - Data to write
   */
  async writeJsonFile(filePath, data) {
    try {
      await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error(`Error writing JSON file ${filePath}`, 'File', { filePath, error: error.message });
      throw error;
    }
  }

  /**
   * Get configuration
   * @returns {Promise<Object>} Configuration object
   */
  async getConfig() {
    if (!this.cache.config) {
      this.cache.config = await this.readJsonFile(this.configFile);
    }
    return this.cache.config;
  }

  /**
   * Save configuration
   * @param {Object} config - Configuration object
   */
  async saveConfig(config) {
    this.cache.config = config;
    this._scheduleWrite(this.configFile, config);
  }

  /**
   * Get conversation history for a user
   * @param {string} userId - User ID (phone number with @c.us)
   * @returns {Promise<Object>} Conversation object
   */
  async getConversation(userId) {
    const conversations = await this.getAllConversations();
    return conversations[userId] || {
      sessionId: 'default',
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  /**
   * Save a message to conversation history
   * @param {string} userId - User ID
   * @param {string} content - Message content
   * @param {string} type - Message type (text, image, etc.)
   * @param {string} sender - Sender (user or ai)
   * @param {Object} rawData - Raw message data from WAHA
   */
  async saveMessage(userId, content, type, sender, rawData = {}) {
    const conversations = await this.getAllConversations();
    
    if (!conversations[userId]) {
      conversations[userId] = {
        sessionId: 'default',
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    }

    const message = {
      id: uuidv4(),
      content,
      type,
      sender,
      timestamp: new Date().toISOString(),
      rawData
    };

    conversations[userId].messages.push(message);
    conversations[userId].updatedAt = new Date().toISOString();
    
    // Keep only last 50 messages per conversation to prevent file from growing too large
    if (conversations[userId].messages.length > 50) {
      conversations[userId].messages = conversations[userId].messages.slice(-50);
    }

    this.cache.conversations = conversations;
    this._scheduleWrite(this.conversationsFile, conversations);

    // Append to permanent JSONL message log
    try {
      const logRecord = {
        id: message.id,
        userId,
        content,
        type,
        sender,
        timestamp: message.timestamp
      };
      await fs.writeFile(this.messagesLogFile, JSON.stringify(logRecord) + "\n", { flag: 'a' });
    } catch (err) {
      logger.warn('Memory', 'Failed to append to messages log', { error: err.message });
    }

    // Update status (buffered)
    this.updateStatus({ messagesProcessed: 1, lastMessageAt: new Date().toISOString() }).catch(() => {});
  }

  /**
   * Get all conversations
   * @returns {Promise<Object>} All conversations
   */
  async getAllConversations() {
    if (!this.cache.conversations) {
      let conversations = await this.readJsonFile(this.conversationsFile);
      // Harden against unexpected shapes at runtime
      if (!conversations || typeof conversations !== 'object' || Array.isArray(conversations)) {
        conversations = {};
      }
      this.cache.conversations = conversations;
    }
    return this.cache.conversations;
  }

  /**
   * Get system status
   * @returns {Promise<Object>} Status object
   */
  async getStatus() {
    if (!this.cache.status) {
      this.cache.status = await this.readJsonFile(this.statusFile);
    }
    return this.cache.status;
  }

  /**
   * Update system status
   * @param {Object} updates - Status updates
   */
  async updateStatus(updates) {
    const status = await this.getStatus();
    
    // Handle incremental updates
    if (updates.messagesProcessed && typeof updates.messagesProcessed === 'number') {
      status.messagesProcessed = (status.messagesProcessed || 0) + updates.messagesProcessed;
    }
    
    // Handle direct updates
    Object.keys(updates).forEach(key => {
      if (key !== 'messagesProcessed' || typeof updates[key] !== 'number') {
        status[key] = updates[key];
      }
    });
    
    this.cache.status = status;
    this._scheduleWrite(this.statusFile, status, 150);
  }

  /**
   * Add an error to the status
   * @param {string} error - Error message
   */
  async addError(error) {
    const status = await this.getStatus();
    if (!status.errors) {
      status.errors = [];
    }
    
    status.errors.push({
      message: error,
      timestamp: new Date().toISOString()
    });
    
    // Keep only last 10 errors
    if (status.errors.length > 10) {
      status.errors = status.errors.slice(-10);
    }
    
    this.cache.status = status;
    this._scheduleWrite(this.statusFile, status, 150);
  }

  /**
   * Clear cache to force reload from files
   */
  clearCache() {
    this.cache = {
      config: null,
      conversations: null,
      status: null
    };
    // Clear buffered write state
    try { WRITE_BUFFERS.clear(); } catch (_) {}
  }

  /**
   * Read full conversation history for a user from the permanent JSONL log
   * Note: This scans the entire log; for very large logs consider a DB.
   * @param {string} userId
   * @returns {Promise<Array<{id:string,content:string,type:string,sender:string,timestamp:string}>>}
   */
  async getFullConversationHistory(userId) {
    try {
      const data = await fs.readFile(this.messagesLogFile, 'utf8');
      if (!data) return [];
      const lines = data.split(/\r?\n/);
      const history = [];
      for (const line of lines) {
        if (!line) continue;
        try {
          const rec = JSON.parse(line);
          if (rec && rec.userId === userId) {
            history.push({
              id: rec.id,
              content: rec.content,
              type: rec.type,
              sender: rec.sender,
              timestamp: rec.timestamp
            });
          }
        } catch (_) {
          // skip bad line
        }
      }
      return history;
    } catch (err) {
      logger.warn('Memory', 'Failed to read messages log', { error: err.message });
      return [];
    }
  }

  /**
   * Get last N messages for a user from the permanent log
   * @param {string} userId
   * @param {number} limit
   */
  async getRecentHistoryFromLog(userId, limit = 50) {
    const all = await this.getFullConversationHistory(userId);
    return all.slice(-Math.max(0, limit));
  }
}

module.exports = new MemoryService();
