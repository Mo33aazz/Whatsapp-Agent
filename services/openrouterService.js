const httpClient = require('../utils/httpClient');
const memoryService = require('./memoryService');

class OpenRouterService {
  constructor() {
    this.baseUrl = 'https://openrouter.ai/api/v1';
    this.defaultModel = 'openai/gpt-4o-mini';
    this.defaultHistoryLimit = 8; // smaller context -> faster responses
    this.defaultMaxTokens = 350;  // keep outputs concise for WhatsApp
  }

  /**
   * Generate AI response using OpenRouter API
   * @param {string} message - User message
   * @param {Array} conversationHistory - Previous messages for context
   * @returns {Promise<string>} AI generated response
   */
  async generateResponse(message, conversationHistory = []) {
    try {
      const config = await memoryService.getConfig();
      
      if (!config || !config.openrouterApiKey) {
        throw new Error('OpenRouter API key not configured');
      }

      // Determine if this is a vision (image) request
      const isImageRequest = message && typeof message === 'object' && message.kind === 'image' && message.base64;

      // Prefer a vision-capable model for image requests
      let model = config.aiModel || this.defaultModel;
      if (isImageRequest) {
        const m = (model || '').toLowerCase();
        const likelyVision = (
          m.includes('gpt-4o') || m.includes('gpt-4.1') || m.includes('omni') ||
          m.includes('vision') || m.includes('llava') || m.includes('qwen') ||
          m.includes('glm-4v') || m.includes('llama-3.2') || m.includes('sonnet-3') || m.includes('claude-3')
        );
        if (!likelyVision) {
          // Fallback to a safe, vision-capable default
          model = this.defaultModel; // 'openai/gpt-4o-mini'
        }
      }
      const systemPrompt = config.systemPrompt || 'You are a helpful WhatsApp assistant.';
      const historyLimit = Number(config.historyLimit || this.defaultHistoryLimit);
      const maxTokens = Number(config.maxTokens || this.defaultMaxTokens);

      // Prepare messages for the API
      const messages = [
        {
          role: 'system',
          content: systemPrompt
        }
      ];

      // Add conversation history (keep compact for latency & cost)
      const recentHistory = conversationHistory.slice(-historyLimit);
      for (const msg of recentHistory) {
        // Avoid injecting large base64 images into history; replace with placeholder
        if (msg.type === 'image') {
          messages.push({
            role: msg.sender === 'user' ? 'user' : 'assistant',
            content: '[image sent earlier – omitted from context]'
          });
        } else {
          messages.push({
            role: msg.sender === 'user' ? 'user' : 'assistant',
            content: msg.content
          });
        }
      }

      // Add current message
      if (isImageRequest) {
        const mime = message.mimeType || 'image/jpeg';
        const dataUrl = `data:${mime};base64,${message.base64}`;
        const parts = [];
        const caption = (message.caption || '').toString().trim();
        if (caption) {
          parts.push({ type: 'text', text: caption });
        } else {
          parts.push({ type: 'text', text: 'Please analyze this image and describe its contents.' });
        }
        parts.push({ type: 'image_url', image_url: { url: dataUrl } });

        messages.push({ role: 'user', content: parts });
      } else {
        messages.push({ role: 'user', content: message });
      }

      const response = await httpClient.post(`${this.baseUrl}/chat/completions`, {
        model: model,
        messages: messages,
        max_tokens: maxTokens,
        temperature: 0.5,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0
      }, {
        headers: {
          'Authorization': `Bearer ${config.openrouterApiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': `http://localhost:${process.env.PORT || 3001}`,
          'X-Title': 'WhatsApp AI Bot'
        },
        timeout: 20000
      });

      if (response.data && response.data.choices && response.data.choices.length > 0) {
        const aiResponse = response.data.choices[0].message.content.trim();
        
        // Ensure response is not too long for WhatsApp
        if (aiResponse.length > 4000) {
          return aiResponse.substring(0, 3900) + '... (message truncated)';
        }
        
        return aiResponse;
      } else {
        throw new Error('No response generated from AI model');
      }
    } catch (error) {
      console.error('Error generating AI response:', error.message);
      
      if (error.response) {
        console.error('OpenRouter API Error:', {
          status: error.response.status,
          data: error.response.data
        });
        
        if (error.response.status === 401) {
          throw new Error('Invalid OpenRouter API key');
        } else if (error.response.status === 429) {
          throw new Error('Rate limit exceeded. Please try again later.');
        } else if (error.response.status === 400) {
          throw new Error('Invalid request to OpenRouter API');
        }
      }
      
      throw new Error(`Failed to generate AI response: ${error.message}`);
    }
  }

  /**
   * Test the OpenRouter API connection and configuration
   * @returns {Promise<boolean>} Test result
   */
  async testConnection() {
    try {
      const config = await memoryService.getConfig();
      
      if (!config || !config.openrouterApiKey) {
        return false;
      }

      const response = await httpClient.post(`${this.baseUrl}/chat/completions`, {
        model: config.aiModel || this.defaultModel,
        messages: [
          {
            role: 'user',
            content: 'Hello, this is a test message.'
          }
        ],
        max_tokens: 10
      }, {
        headers: {
          'Authorization': `Bearer ${config.openrouterApiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': `http://localhost:${process.env.PORT || 3001}`,
          'X-Title': 'WhatsApp AI Bot'
        },
        timeout: 10000
      });

      return response.status === 200;
    } catch (error) {
      console.error('OpenRouter connection test failed:', error.message);
      return false;
    }
  }

  /**
   * Get available models from OpenRouter
   * @param {string} [apiKeyOverride] - Optional API key to use instead of saved config
   * @returns {Promise<Array>} List of available models (raw objects from API)
   */
  async getAvailableModels(apiKeyOverride) {
    try {
      const config = await memoryService.getConfig();
      const keyToUse = (apiKeyOverride && apiKeyOverride.trim())
        ? apiKeyOverride.trim()
        : (config?.openrouterApiKey || '');
      
      if (!keyToUse) {
        throw new Error('OpenRouter API key not configured');
      }

      const response = await httpClient.get(`${this.baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${keyToUse}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      });

      return response.data?.data || [];
    } catch (error) {
      console.error('Error getting available models:', error.message);
      return [];
    }
  }

  /**
   * Test a specific API key without saving it to configuration
   * @param {string} apiKey - The API key to test
   * @returns {Promise<Object>} Test result with success status and details
   */
  async testApiKey(apiKey) {
    try {
      if (!apiKey || !apiKey.trim()) {
        return {
          success: false,
          message: 'API key is required'
        };
      }

      // Test the API key with a simple request
      const response = await httpClient.post(`${this.baseUrl}/chat/completions`, {
        model: this.defaultModel,
        messages: [
          {
            role: 'user',
            content: 'Test connection'
          }
        ],
        max_tokens: 5
      }, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': `http://localhost:${process.env.PORT || 3001}`,
          'X-Title': 'WhatsApp AI Bot'
        },
        timeout: 10000
      });

      if (response.status === 200) {
        return {
          success: true,
          message: 'API key is valid and working',
          details: {
            model: this.defaultModel,
            status: 'Connected successfully'
          }
        };
      } else {
        return {
          success: false,
          message: 'Unexpected response from OpenRouter API'
        };
      }
    } catch (error) {
      console.error('API key test failed:', error.message);
      
      if (error.response) {
        const status = error.response.status;
        const errorData = error.response.data;
        
        if (status === 401) {
          return {
            success: false,
            message: 'Invalid API key or unauthorized access'
          };
        } else if (status === 429) {
          return {
            success: false,
            message: 'Rate limit exceeded. Please try again later.'
          };
        } else if (status === 400) {
          return {
            success: false,
            message: 'Bad request. Please check your API key format.'
          };
        } else {
          return {
            success: false,
            message: `API error (${status}): ${errorData?.error?.message || 'Unknown error'}`
          };
        }
      } else if (error.code === 'ECONNABORTED') {
        return {
          success: false,
          message: 'Connection timeout. Please check your internet connection.'
        };
      } else {
        return {
          success: false,
          message: `Connection failed: ${error.message}`
        };
      }
    }
  }

  /**
   * Check if OpenRouter is properly configured
   * @returns {Promise<boolean>} Configuration status
   */
  async isConfigured() {
    try {
      const config = await memoryService.getConfig();
      return !!(config && config.openrouterApiKey && config.openrouterApiKey.trim());
    } catch (error) {
      console.error('Error checking OpenRouter configuration:', error.message);
      return false;
    }
  }
}

module.exports = new OpenRouterService();
