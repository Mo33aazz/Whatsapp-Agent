const wahaService = require('./wahaService');
const openrouterService = require('./openrouterService');
const memoryService = require('./memoryService');

class MessageProcessor {
  constructor() {
    this.processingQueue = new Map();
  }

  /**
   * Process incoming WhatsApp message and generate AI response
   * @param {Object} payload - Message payload from WAHA webhook
   * @param {string} session - Session identifier
   * @returns {Promise<boolean>} Processing result
   */
  async processMessage(payload, session) {
    try {
      // Extract message information
      const messageId = payload.id;
      const chatId = payload.from;
      const messageBody = payload.body;
      const messageType = payload.type || 'text';
      const isFromMe = payload.fromMe;
      
      console.log('Processing message:', {
        messageId,
        chatId,
        messageBody,
        messageType,
        isFromMe
      });

      // Skip messages from the bot itself
      if (isFromMe) {
        console.log('Skipping message from bot itself');
        return false;
      }

      // Skip non-text messages for now
      if (messageType !== 'text' && messageType !== 'chat') {
        console.log(`Skipping non-text message type: ${messageType}`);
        return false;
      }

      // Skip empty messages
      if (!messageBody || messageBody.trim().length === 0) {
        console.log('Skipping empty message');
        return false;
      }

      // Prevent duplicate processing
      if (this.processingQueue.has(messageId)) {
        console.log('Message already being processed');
        return false;
      }

      // Add to processing queue
      this.processingQueue.set(messageId, true);

      try {
        // Check if OpenRouter is configured
        const config = await memoryService.getConfig();
        if (!config || !config.openrouterApiKey) {
          console.log('OpenRouter not configured, skipping AI response');
          return false;
        }

        // Save user message to memory
        await memoryService.saveMessage(
          chatId,
          messageBody,
          messageType,
          'user',
          payload
        );

        // Get conversation history for context
        const conversation = await memoryService.getConversation(chatId);
        const conversationHistory = conversation.messages || [];

        // Generate AI response
        console.log('Generating AI response...');
        const aiResponse = await openrouterService.generateResponse(
          messageBody,
          conversationHistory
        );

        if (aiResponse && aiResponse.trim().length > 0) {
          // Send AI response back to WhatsApp
          console.log('Sending AI response:', aiResponse);
          await wahaService.sendMessage(chatId, aiResponse);

          // Save AI response to memory
          await memoryService.saveMessage(
            chatId,
            aiResponse,
            'text',
            'ai',
            { generated: true }
          );

          console.log('Message processed successfully');
          return true;
        } else {
          console.log('No AI response generated');
          await memoryService.addError('Empty AI response generated');
          return false;
        }
      } catch (error) {
        console.error('Error processing message:', error);
        await memoryService.addError(`Message processing error: ${error.message}`);
        
        // Send error message to user if it's a critical error
        if (error.message.includes('API key') || error.message.includes('configuration')) {
          try {
            await wahaService.sendMessage(
              chatId,
              'Sorry, I\'m currently not configured properly. Please contact the administrator.'
            );
          } catch (sendError) {
            console.error('Error sending error message:', sendError);
          }
        }
        
        return false;
      } finally {
        // Remove from processing queue
        this.processingQueue.delete(messageId);
      }
    } catch (error) {
      console.error('Critical error in message processing:', error);
      await memoryService.addError(`Critical processing error: ${error.message}`);
      return false;
    }
  }

  /**
   * Process system events (like session status changes)
   * @param {Object} payload - Event payload from WAHA webhook
   * @param {string} session - Session identifier
   * @returns {Promise<boolean>} Processing result
   */
  async processSystemEvent(payload, session) {
    try {
      console.log('Processing system event:', payload);
      
      if (payload.event === 'session.status') {
        const status = payload.status;
        console.log(`Session status changed to: ${status}`);
        
        await memoryService.updateStatus({
          wahaConnected: status === 'WORKING' || status === 'AUTHENTICATED'
        });
        
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Error processing system event:', error);
      await memoryService.addError(`System event processing error: ${error.message}`);
      return false;
    }
  }

  /**
   * Get processing queue status
   * @returns {Object} Queue status information
   */
  getQueueStatus() {
    return {
      queueSize: this.processingQueue.size,
      processingMessages: Array.from(this.processingQueue.keys())
    };
  }

  /**
   * Clear processing queue (useful for debugging)
   */
  clearQueue() {
    this.processingQueue.clear();
    console.log('Processing queue cleared');
  }

  /**
   * Handle rate limiting and delays
   * @param {number} delay - Delay in milliseconds
   */
  async delay(delay) {
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Validate message payload
   * @param {Object} payload - Message payload
   * @returns {boolean} Validation result
   */
  validatePayload(payload) {
    if (!payload) {
      console.log('Invalid payload: null or undefined');
      return false;
    }

    if (!payload.id) {
      console.log('Invalid payload: missing message ID');
      return false;
    }

    if (!payload.from) {
      console.log('Invalid payload: missing sender information');
      return false;
    }

    return true;
  }
}

module.exports = new MessageProcessor();