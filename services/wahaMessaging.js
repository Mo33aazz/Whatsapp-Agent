const httpClient = require('../utils/httpClient');
const logger = require('../utils/logger');

class WAHAMessaging {
  constructor(baseURL, sessionName) {
    this.baseURL = baseURL;
    this.sessionName = sessionName;
  }

  // Message sending
  async sendMessage(to, text, options = {}) {
    const preview = (text || '').toString();
    logger.info('Messaging', `Sending message to ${to}`, { preview: preview.substring(0, 100) + (preview.length > 100 ? '...' : '') });
    const messageData = {
      chatId: to,
      text: text,
      session: this.sessionName,
      ...options
    };

    const attempt = async () => {
      return httpClient.post(
        `${this.baseURL}/api/sendText`,
        messageData,
        {
          timeout: 30000,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    };

    let lastErr;
    const maxRetries = 2;
    for (let i = 0; i <= maxRetries; i++) {
      try {
        const response = await attempt();
        logger.info('Messaging', 'Message sent successfully', { data: response.data });
        return response.data;
      } catch (error) {
        lastErr = error;
        const status = error?.response?.status;
        const retriable = !status || status >= 500 || error.code === 'ECONNABORTED' || error.code === 'ECONNRESET';
        logger.warn('Messaging', `Error sending message (attempt ${i + 1}/${maxRetries + 1})`, { error: error.message });
        if (!retriable || i === maxRetries) break;
        const delay = 500 * Math.pow(2, i);
        await new Promise(r => setTimeout(r, delay));
      }
    }
    if (lastErr && lastErr.response) {
      logger.error('Response status', 'Messaging', { status: lastErr.response.status });
        logger.error('Response data', 'Messaging', { data: lastErr.response.data });
    }
    throw new Error(`Failed to send message: ${lastErr ? lastErr.message : 'unknown error'}`);
  }

  // Typing indicators
  async startTyping(chatId) {
    try {
      logger.debug('Messaging', `Starting typing indicator for chat: ${chatId}`);
      // Use WAHA ChattingController_startTyping
      await httpClient.post(
        `${this.baseURL}/api/startTyping`,
        { chatId, session: this.sessionName },
        {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
      return { result: true };
    } catch (error) {
      // Do not throw to avoid breaking message flow if typing fails
      logger.warn('Messaging', `Error starting typing for ${chatId}`, { error: error.message });
      return { result: false, error: error.message };
    }
  }

  async stopTyping(chatId) {
    try {
      logger.debug('Messaging', `Stopping typing indicator for chat: ${chatId}`);
      // Use WAHA ChattingController_stopTyping
      await httpClient.post(
        `${this.baseURL}/api/stopTyping`,
        { chatId, session: this.sessionName },
        {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
      return { result: true };
    } catch (error) {
      // Do not throw to avoid breaking message flow if typing fails
      logger.warn('Messaging', `Error stopping typing for ${chatId}`, { error: error.message });
      return { result: false, error: error.message };
    }
  }

  async _sendTypingRequest(chatId, isTyping) {
    // Kept for backward compatibility; route to start/stop endpoints
    return isTyping ? this.startTyping(chatId) : this.stopTyping(chatId);
  }

  // Advanced messaging methods
  async sendImage(to, imageUrl, caption = '', options = {}) {
    try {
      logger.info('Messaging', `Sending image to ${to}`, { imageUrl });
      
      const messageData = {
        chatId: to,
        file: {
          url: imageUrl
        },
        caption: caption,
        session: this.sessionName,
        ...options
      };
      
      const response = await httpClient.post(
        `${this.baseURL}/api/sendImage`,
        messageData,
        {
          timeout: 60000,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
      
      logger.info('Messaging', 'Image sent successfully', { data: response.data });
      return response.data;
    } catch (error) {
      logger.error('Error sending image', 'Messaging', { error: error.message });
      throw new Error(`Failed to send image: ${error.message}`);
    }
  }

  async sendDocument(to, documentUrl, filename = '', caption = '', options = {}) {
    try {
      logger.info('Messaging', `Sending document to ${to}`, { documentUrl });
      
      const messageData = {
        chatId: to,
        file: {
          url: documentUrl,
          filename: filename
        },
        caption: caption,
        session: this.sessionName,
        ...options
      };
      
      const response = await httpClient.post(
        `${this.baseURL}/api/sendFile`,
        messageData,
        {
          timeout: 60000,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
      
      logger.info('Messaging', 'Document sent successfully', { data: response.data });
      return response.data;
    } catch (error) {
      logger.error('Error sending document', 'Messaging', { error: error.message });
      throw new Error(`Failed to send document: ${error.message}`);
    }
  }

  async sendAudio(to, audioUrl, options = {}) {
    try {
      logger.info('Messaging', `Sending audio to ${to}`, { audioUrl });
      
      const messageData = {
        chatId: to,
        file: {
          url: audioUrl
        },
        session: this.sessionName,
        ...options
      };
      
      const response = await httpClient.post(
        `${this.baseURL}/api/sendVoice`,
        messageData,
        {
          timeout: 60000,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
      
      logger.info('Messaging', 'Audio sent successfully', { data: response.data });
      return response.data;
    } catch (error) {
      logger.error('Error sending audio', 'Messaging', { error: error.message });
      throw new Error(`Failed to send audio: ${error.message}`);
    }
  }

  async sendLocation(to, latitude, longitude, name = '', address = '', options = {}) {
    try {
      logger.info('Messaging', `Sending location to ${to}`, { latitude, longitude, name });
      
      const messageData = {
        chatId: to,
        latitude: latitude,
        longitude: longitude,
        name: name,
        address: address,
        session: this.sessionName,
        ...options
      };
      
      const response = await httpClient.post(
        `${this.baseURL}/api/sendLocation`,
        messageData,
        {
          timeout: 30000,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
      
      logger.info('Messaging', 'Location sent successfully', { data: response.data });
      return response.data;
    } catch (error) {
      logger.error('Error sending location', 'Messaging', { error: error.message });
      throw new Error(`Failed to send location: ${error.message}`);
    }
  }

  async sendContact(to, contact, options = {}) {
    try {
      logger.info('Messaging', `Sending contact to ${to}`, { contact: contact.name || contact.phone });
      
      const messageData = {
        chatId: to,
        contact: contact,
        session: this.sessionName,
        ...options
      };
      
      const response = await httpClient.post(
        `${this.baseURL}/api/sendContact`,
        messageData,
        {
          timeout: 30000,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
      
      logger.info('Messaging', 'Contact sent successfully', { data: response.data });
      return response.data;
    } catch (error) {
      logger.error('Error sending contact', 'Messaging', { error: error.message });
      throw new Error(`Failed to send contact: ${error.message}`);
    }
  }

  // Message status and management
  async markAsRead(chatId, messageId) {
    try {
      logger.debug('Messaging', `Marking message as read in chat ${chatId}`, { messageId });
      // Use WAHA ChattingController_sendSeen (SendSeenRequest)
      const body = {
        chatId,
        messageIds: messageId ? [messageId] : undefined,
        session: this.sessionName
      };
      const response = await httpClient.post(
        `${this.baseURL}/api/sendSeen`,
        body,
        {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
      logger.debug('Messaging', 'Sent seen/read receipt', { data: response.data });
      return response.data;
    } catch (error) {
      logger.error('Error marking message as read', 'Messaging', { error: error.message });
      throw error;
    }
  }

  async deleteMessage(chatId, messageId, forEveryone = false) {
    try {
      logger.info('Messaging', `Deleting message in chat ${chatId}`, { messageId, forEveryone: forEveryone ? 'for everyone' : 'for me' });
      
      const response = await httpClient.delete(
        `${this.baseURL}/api/${this.sessionName}/chats/${chatId}/messages/${messageId}`,
        {
          data: { forEveryone: forEveryone },
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
      
      logger.info('Messaging', 'Message deleted', { data: response.data });
      return response.data;
    } catch (error) {
      logger.error('Error deleting message', 'Messaging', { error: error.message });
      throw error;
    }
  }

  // Chat management
  async getChatMessages(chatId, limit = 50, offset = 0) {
    try {
      logger.debug('Messaging', `Getting messages for chat ${chatId}`, { limit, offset });
      
      const response = await httpClient.get(
        `${this.baseURL}/api/${this.sessionName}/chats/${chatId}/messages`,
        {
          params: { limit, offset },
          timeout: 15000,
          headers: {
            'Accept': 'application/json'
          }
        }
      );
      
      logger.debug('Messaging', `Retrieved messages for chat ${chatId}`, { count: response.data?.length || 0 });
      return response.data;
    } catch (error) {
      logger.error('Error getting chat messages', 'Messaging', { error: error.message });
      throw error;
    }
  }

  async getChatInfo(chatId) {
    try {
      logger.info('Messaging', `Getting chat info for: ${chatId}`);
      
      const response = await httpClient.get(
        `${this.baseURL}/api/${this.sessionName}/chats/${chatId}`,
        {
          timeout: 10000,
          headers: {
            'Accept': 'application/json'
          }
        }
      );
      
      logger.info('Messaging', 'Chat info retrieved', { name: response.data?.name || chatId });
      return response.data;
    } catch (error) {
      logger.error('Error getting chat info', 'Messaging', { error: error.message });
      throw error;
    }
  }

  // Utility methods
  async sendTypingWithDuration(chatId, durationMs = 3000) {
    try {
      await this.startTyping(chatId);
      await this._sleep(durationMs);
      await this.stopTyping(chatId);
    } catch (error) {
      logger.error('Error in typing with duration', 'Messaging', { error: error.message });
      // Try to stop typing even if start failed
      try {
        await this.stopTyping(chatId);
      } catch (stopError) {
        logger.error('Error stopping typing after failure', 'Messaging', { error: stopError.message });
      }
      throw error;
    }
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Message formatting helpers
  formatPhoneNumber(phone) {
    // Remove all non-digit characters
    const cleaned = phone.replace(/\D/g, '');
    
    // Add country code if missing (assuming +1 for US/Canada)
    if (cleaned.length === 10) {
      return `1${cleaned}@c.us`;
    }
    
    // If already has country code
    if (cleaned.length > 10) {
      return `${cleaned}@c.us`;
    }
    
    throw new Error('Invalid phone number format');
  }

  formatGroupId(groupId) {
    if (groupId.includes('@g.us')) {
      return groupId;
    }
    return `${groupId}@g.us`;
  }

  isGroupChat(chatId) {
    return chatId.includes('@g.us');
  }

  isPrivateChat(chatId) {
    return chatId.includes('@c.us');
  }
}

module.exports = WAHAMessaging;
