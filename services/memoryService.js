const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class MemoryService {
  constructor() {
    this.dataDir = path.join(__dirname, '..', 'data');
    this.configFile = path.join(this.dataDir, 'config.json');
    this.conversationsFile = path.join(this.dataDir, 'conversations.json');
    this.statusFile = path.join(this.dataDir, 'status.json');
    
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
      
      await this.ensureFileExists(this.statusFile, {
        wahaConnected: false,
        openrouterConfigured: false,
        messagesProcessed: 0,
        lastMessageAt: null,
        uptime: '0h 0m',
        errors: []
      });
      
      console.log('Memory service initialized successfully');
    } catch (error) {
      console.error('Error initializing memory service:', error);
      throw error;
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
      webhookUrl: process.env.WEBHOOK_URL || 'http://localhost:5000/webhook',
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
        console.log('Synced OpenRouter API key from environment variables');
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
        console.log('Configuration synchronized with environment variables');
      }
    } catch (error) {
      console.error('Error syncing config with environment:', error);
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
   * Read and parse JSON file
   * @param {string} filePath - Path to the JSON file
   * @returns {Promise<Object>} Parsed JSON content
   */
  async readJsonFile(filePath) {
    try {
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error(`Error reading JSON file ${filePath}:`, error);
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
      console.error(`Error writing JSON file ${filePath}:`, error);
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
    await this.writeJsonFile(this.configFile, config);
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
    await this.writeJsonFile(this.conversationsFile, conversations);
    
    // Update status
    await this.updateStatus({ messagesProcessed: 1, lastMessageAt: new Date().toISOString() });
  }

  /**
   * Get all conversations
   * @returns {Promise<Object>} All conversations
   */
  async getAllConversations() {
    if (!this.cache.conversations) {
      this.cache.conversations = await this.readJsonFile(this.conversationsFile);
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
    await this.writeJsonFile(this.statusFile, status);
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
    await this.writeJsonFile(this.statusFile, status);
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
  }
}

module.exports = new MemoryService();