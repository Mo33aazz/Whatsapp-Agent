const httpClient = require('../utils/httpClient');

class WAHAMessaging {
  constructor(baseURL, sessionName) {
    this.baseURL = baseURL;
    this.sessionName = sessionName;
  }

  // Message sending
  async sendMessage(to, text, options = {}) {
    try {
      console.log(`Sending message to ${to}:`, text.substring(0, 100) + (text.length > 100 ? '...' : ''));
      
      const messageData = {
        chatId: to,
        text: text,
        session: this.sessionName,
        ...options
      };
      
      const response = await httpClient.post(
        `${this.baseURL}/api/sendText`,
        messageData,
        {
          timeout: 30000,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
      
      console.log('Message sent successfully:', response.data);
      return response.data;
    } catch (error) {
      console.error('Error sending message:', error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
      }
      throw new Error(`Failed to send message: ${error.message}`);
    }
  }

  // Typing indicators
  async startTyping(chatId) {
    try {
      console.log(`Starting typing indicator for chat: ${chatId}`);
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
      console.warn(`Error starting typing for ${chatId}:`, error.message);
      return { result: false, error: error.message };
    }
  }

  async stopTyping(chatId) {
    try {
      console.log(`Stopping typing indicator for chat: ${chatId}`);
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
      console.warn(`Error stopping typing for ${chatId}:`, error.message);
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
      console.log(`Sending image to ${to}:`, imageUrl);
      
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
      
      console.log('Image sent successfully:', response.data);
      return response.data;
    } catch (error) {
      console.error('Error sending image:', error.message);
      throw new Error(`Failed to send image: ${error.message}`);
    }
  }

  async sendDocument(to, documentUrl, filename = '', caption = '', options = {}) {
    try {
      console.log(`Sending document to ${to}:`, documentUrl);
      
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
      
      console.log('Document sent successfully:', response.data);
      return response.data;
    } catch (error) {
      console.error('Error sending document:', error.message);
      throw new Error(`Failed to send document: ${error.message}`);
    }
  }

  async sendAudio(to, audioUrl, options = {}) {
    try {
      console.log(`Sending audio to ${to}:`, audioUrl);
      
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
      
      console.log('Audio sent successfully:', response.data);
      return response.data;
    } catch (error) {
      console.error('Error sending audio:', error.message);
      throw new Error(`Failed to send audio: ${error.message}`);
    }
  }

  async sendLocation(to, latitude, longitude, name = '', address = '', options = {}) {
    try {
      console.log(`Sending location to ${to}:`, { latitude, longitude, name });
      
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
      
      console.log('Location sent successfully:', response.data);
      return response.data;
    } catch (error) {
      console.error('Error sending location:', error.message);
      throw new Error(`Failed to send location: ${error.message}`);
    }
  }

  async sendContact(to, contact, options = {}) {
    try {
      console.log(`Sending contact to ${to}:`, contact.name || contact.phone);
      
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
      
      console.log('Contact sent successfully:', response.data);
      return response.data;
    } catch (error) {
      console.error('Error sending contact:', error.message);
      throw new Error(`Failed to send contact: ${error.message}`);
    }
  }

  // Message status and management
  async markAsRead(chatId, messageId) {
    try {
      console.log(`Marking message as read in chat ${chatId}:`, messageId);
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
      console.log('Sent seen/read receipt:', response.data);
      return response.data;
    } catch (error) {
      console.error('Error marking message as read:', error.message);
      throw error;
    }
  }

  async deleteMessage(chatId, messageId, forEveryone = false) {
    try {
      console.log(`Deleting message in chat ${chatId}:`, messageId, forEveryone ? '(for everyone)' : '(for me)');
      
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
      
      console.log('Message deleted:', response.data);
      return response.data;
    } catch (error) {
      console.error('Error deleting message:', error.message);
      throw error;
    }
  }

  // Chat management
  async getChatMessages(chatId, limit = 50, offset = 0) {
    try {
      console.log(`Getting messages for chat ${chatId} (limit: ${limit}, offset: ${offset})`);
      
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
      
      console.log(`Retrieved ${response.data?.length || 0} messages for chat ${chatId}`);
      return response.data;
    } catch (error) {
      console.error('Error getting chat messages:', error.message);
      throw error;
    }
  }

  async getChatInfo(chatId) {
    try {
      console.log(`Getting chat info for: ${chatId}`);
      
      const response = await httpClient.get(
        `${this.baseURL}/api/${this.sessionName}/chats/${chatId}`,
        {
          timeout: 10000,
          headers: {
            'Accept': 'application/json'
          }
        }
      );
      
      console.log('Chat info retrieved:', response.data?.name || chatId);
      return response.data;
    } catch (error) {
      console.error('Error getting chat info:', error.message);
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
      console.error('Error in typing with duration:', error.message);
      // Try to stop typing even if start failed
      try {
        await this.stopTyping(chatId);
      } catch (stopError) {
        console.error('Error stopping typing after failure:', stopError.message);
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
