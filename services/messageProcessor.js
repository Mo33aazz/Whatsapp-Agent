const wahaService = require('./wahaService');
const openrouterService = require('./openrouterService');
const httpClient = require('../utils/httpClient');
const memoryService = require('./memoryService');
const logger = require('../utils/logger');

class MessageProcessor {
  constructor() {
    this.processingQueue = new Set();
  }

  /**
   * Process incoming WhatsApp message and generate AI response
   * @param {Object} payload - Message payload from WAHA webhook
   * @param {string} session - Session identifier
   * @returns {Promise<boolean>} Processing result
   */
  async processMessage(payload, session) {
    const timestamp = new Date().toISOString();
    logger.info('MSG', `Starting message processing at ${timestamp}`);
    logger.debug('MSG', 'Raw payload received', { payload });
    
    try {
      // First validate the payload
      if (!this.validatePayload(payload)) {
        logger.warn('MSG', 'Payload validation failed - skipping message');
        return false;
      }
      logger.debug('MSG', 'Payload validation passed');
      
      // Extract message information
      const messageId = payload?.id
        || payload?.message?.id
        || payload?.key?.id
        || payload?.data?.id
        || payload?.payload?.id;
      const chatId = payload?.from
        || payload?.chatId
        || payload?.chat?.id
        || payload?.remoteJid
        || payload?.payload?.from;
      const messageBody = (payload?.body ?? payload?.text ?? payload?.message?.text ?? payload?.payload?.body ?? '')
        .toString();
      const messageType = payload?.type || payload?.message?.type || 'text';
      const isFromMe = !!(payload?.fromMe || payload?.message?.fromMe || payload?.key?.fromMe);
      
      logger.info('MSG', 'Extracted message details', {
        messageId,
        chatId,
        messageBody: messageBody.substring(0, 100) + (messageBody.length > 100 ? '...' : ''),
        messageType,
        isFromMe,
        payloadKeys: Object.keys(payload || {})
      });

      // Skip messages from bot itself
      if (isFromMe) {
        logger.debug('MSG', 'Skipping message from bot itself');
        return false;
      }
      logger.debug('MSG', 'Message is from user - proceeding');

            // Identify if this is an image message (by type, mimetype, or base64 signature in any known field)
      const looksLikeBase64Image = (str) => typeof str === 'string' && (
        str.startsWith('/9j/') ||    // jpeg
        str.startsWith('iVBOR') ||   // png
        str.startsWith('R0lGOD') ||  // gif
        str.startsWith('UklGR') ||   // webp (RIFF WebP)
        str.startsWith('Qk')         // bmp
      );
      const base64LooksLikeImage = looksLikeBase64Image(messageBody)
        || looksLikeBase64Image(payload?.body)
        || looksLikeBase64Image(payload?.base64)
        || looksLikeBase64Image(payload?.data)
        || looksLikeBase64Image(payload?.file?.data)
        || looksLikeBase64Image(payload?.media?.base64)
        || looksLikeBase64Image(payload?.media?.data);

      const mimetypeIndicatesImage = (mt) => (typeof mt === 'string') && mt.toLowerCase().startsWith('image/');

      const isImageMessage = (
        messageType === 'image'
      ) || (
        mimetypeIndicatesImage(payload?.mimetype)
        || mimetypeIndicatesImage(payload?.mimeType)
        || mimetypeIndicatesImage(payload?.media?.mimetype)
        || mimetypeIndicatesImage(payload?.file?.mimetype)
      ) || base64LooksLikeImage;

      // Skip unsupported non-text, non-image messages
      if (!isImageMessage && messageType !== 'text' && messageType !== 'chat') {
        logger.debug('MSG', `Skipping unsupported message type: ${messageType}`);
        return false;
      }

      // Skip empty messages only for non-image content
      if (!isImageMessage && (!messageBody || String(messageBody).trim().length === 0)) {
        logger.debug('MSG', 'Skipping empty message');
        return false;
      }

      // Prevent duplicate processing
      const messageKey = `${chatId}_${messageId}`;
      if (this.processingQueue.has(messageKey)) {
        logger.debug('MSG', 'Message already being processed, skipping duplicate');
        return false;
      }
      this.processingQueue.add(messageKey);
      logger.debug('MSG', `Added message to processing queue: ${messageKey}`);

      try {
        // Check if OpenRouter is configured
        if (!(await openrouterService.isConfigured())) {
          logger.warn('MSG', 'OpenRouter not configured - cannot process message');
          return false;
        }
        logger.debug('MSG', 'OpenRouter is configured');

        // Save user message to memory
        logger.debug('MSG', 'Saving user message to memory...');
        const storedContent = isImageMessage
          ? ((typeof messageBody === 'string' && messageBody.trim()) ? '[image: base64 received]' : `[image: ${payload?.mimetype || 'unknown'}]`)
          : messageBody;
        await memoryService.saveMessage(
          chatId,
          storedContent,
          isImageMessage ? 'image' : messageType,
          'user',
          payload
        );
        logger.debug('MSG', 'User message saved to memory');

        // Get full conversation history for context (from permanent JSONL log)
        logger.debug('MSG', 'Retrieving conversation history...');
        const conversationHistory = await memoryService.getRecentHistoryFromLog(chatId, 30);
        logger.debug('MSG', `Retrieved ${conversationHistory.length} messages from history`);

        // Show typing while generating the AI response
        logger.debug('MSG', 'Sending typing indicator...');
        await wahaService.startTyping(chatId);
        logger.debug('MSG', 'Typing indicator sent');
        try {
          // Generate AI response
          logger.info('MSG', 'Generating AI response...');
          let aiResponse;
                    if (isImageMessage) {
            logger.info('MSG', 'Processing image + text input for AI');
            // Build vision input for OpenRouter
            const imageInput = await this.resolveImageInput(payload, messageBody);
            if (!imageInput || !imageInput.base64) {
              logger.warn('MSG', 'Image message missing base64 body (after resolve)');
              return false;
            }

            aiResponse = await openrouterService.generateResponse(
              {
                kind: 'image',
                mimeType: imageInput.mimeType,
                base64: imageInput.base64,
                caption: imageInput.caption
              },
              conversationHistory
            );
          } else {
            logger.info('MSG', 'Processing text-only input for AI');
            aiResponse = await openrouterService.generateResponse(
              messageBody,
              conversationHistory
            );
          }
          logger.info('MSG', `AI response generated (${aiResponse.length} characters)`);

          if (aiResponse && aiResponse.trim().length > 0) {
            // Send AI response back to WhatsApp
            logger.info('MSG', 'Sending AI response to WhatsApp...');
            logger.debug('MSG', 'Sending AI response', { response: aiResponse });
            await wahaService.sendMessage(chatId, aiResponse);
            logger.info('MSG', 'AI response sent successfully');

            // Save AI response to memory
            logger.debug('MSG', 'Saving AI response to memory...');
            await memoryService.saveMessage(
              chatId,
              aiResponse,
              'text',
              'ai',
              { generated: true }
            );
            logger.debug('MSG', 'AI response saved to memory');

            logger.info('MSG', 'Message processing completed successfully!');
            return true;
          } else {
            logger.warn('MSG', 'No AI response generated');
            await memoryService.addError('Empty AI response generated');
            return false;
          }
        } finally {
          // Ensure typing indicator is stopped regardless of outcome
          logger.debug('MSG', 'Stopping typing indicator...');
          await wahaService.stopTyping(chatId);
        }
      } catch (error) {
        logger.error('Error processing message', 'Message', { error: error.message });
      logger.error('Error details', 'Message', {
          message: error.message,
          stack: error.stack,
          chatId,
          messageId,
          messageType
        });
        await memoryService.addError(`Message processing error: ${error.message}`);
        
        // Send error message to user if it's a critical error
        if (error.message.includes('API key') || error.message.includes('configuration')) {
          try {
            logger.info('MSG', 'Sending error message to user...');
            await wahaService.sendMessage(
              chatId,
              'Sorry, I\'m currently not configured properly. Please contact the administrator.'
            );
            logger.info('MSG', 'Error message sent to user');
          } catch (sendError) {
            logger.error('Error sending error message', 'Message', { error: sendError.message });
          }
        }
        
        return false;
      } finally {
        // Remove from processing queue
        logger.debug('MSG', `Removing message from processing queue: ${messageKey}`);
        this.processingQueue.delete(messageKey);
      }
    } catch (error) {
      logger.error('Critical error in message processing', 'Message', { error: error.message });
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
      logger.info('SYS', 'Processing system event', { payload });
      
      if (payload.event === 'session.status') {
        const status = payload.status;
        logger.info('SYS', `Session status changed to: ${status}`);
        
        await memoryService.updateStatus({
          wahaConnected: status === 'WORKING' || status === 'AUTHENTICATED'
        });
        
        return true;
      }
      
      return false;
    } catch (error) {
      logger.error('Error processing system event', 'System', { error: error.message });
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
      processingMessages: Array.from(this.processingQueue)
    };
  }

  /**
   * Clear processing queue (useful for debugging)
   */
  clearQueue() {
    this.processingQueue.clear();
    logger.debug('MSG', 'Processing queue cleared');
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
      logger.warn('MSG', 'Invalid payload: null or undefined');
      return false;
    }

    const hasId = !!(payload?.id || payload?.message?.id || payload?.key?.id || payload?.data?.id || payload?.payload?.id);
    if (!hasId) {
      logger.warn('MSG', 'Invalid payload: missing message ID');
      return false;
    }

    const hasFrom = !!(payload?.from || payload?.chatId || payload?.chat?.id || payload?.remoteJid || payload?.payload?.from);
    if (!hasFrom) {
      logger.warn('MSG', 'Invalid payload: missing sender information');
      return false;
    }

    return true;
  }
  /**
   * Resolve image base64/mime/caption from diverse WAHA payload shapes.
   * @param {Object} payload
   * @param {string} messageBody
   * @returns {Promise<{ base64: string, mimeType: string, caption: string }>}
   */
  async resolveImageInput(payload, messageBody) {
    try {
      const caption = (payload?.caption || payload?.text || '').toString();

      // 1) Try embedded data URL first
      const candidates = [
        messageBody,
        payload?.body,
        payload?.base64,
        payload?.data,
        payload?.file?.data,
        payload?.media?.base64,
        payload?.media?.data,
      ].filter(v => typeof v === 'string' && v.trim());

      for (const c of candidates) {
        const s = c.trim();
        if (s.startsWith('data:image')) {
          const match = s.match(/^data:([^;]+);base64,(.*)$/);
          if (match) {
            const mimeType = match[1] || 'image/jpeg';
            const base64 = match[2] || '';
            if (base64) return { base64, mimeType, caption };
          }
        }
      }

      // 2) Try raw base64 (no prefix)
      const raw = candidates.find(v => !v.startsWith('data:image'));
      if (raw) {
        const mimeType = payload?.mimetype || payload?.mimeType || payload?.media?.mimetype || payload?.file?.mimetype || 'image/jpeg';
        return { base64: raw, mimeType, caption };
      }

      // 3) Try fetching from media URL if provided
      const mediaUrl = payload?.media?.url || payload?.mediaUrl || payload?.url;
      if (mediaUrl) {
        let finalUrl = mediaUrl;
        if (finalUrl.startsWith('/')) {
          // Relative path -> prefix with WAHA base URL
          finalUrl = `${wahaService.baseURL}${finalUrl}`;
        }
        try {
          const resp = await httpClient.get(finalUrl, { responseType: 'arraybuffer', timeout: 20000 });
          const mimeType = (resp.headers && (resp.headers['content-type'] || resp.headers['Content-Type'])) ||
            payload?.mimetype || payload?.mimeType || payload?.media?.mimetype || 'image/jpeg';
          const base64 = Buffer.from(resp.data).toString('base64');
          if (base64) return { base64, mimeType, caption };
        } catch (err) {
          logger.warn('MSG', 'Failed to download media from URL', { mediaUrl, error: err.message });
        }
      }

      // 4) If WAHA indicates media exists but not downloaded, log hint
      if (payload?.hasMedia && !payload?.media) {
        logger.debug('MSG', 'Payload indicates media exists but is not downloaded (no media object)');
      }

      return { base64: '', mimeType: payload?.mimetype || 'image/jpeg', caption };
    } catch (e) {
      logger.warn('MSG', 'Error resolving image input', { error: e.message });
      return { base64: '', mimeType: 'image/jpeg', caption: '' };
    }
  }
}

module.exports = new MessageProcessor();
