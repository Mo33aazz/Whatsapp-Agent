const axios = require('axios');
const memoryService = require('./memoryService');

class OpenRouterService {
  constructor() {
    this.baseUrl = 'https://openrouter.ai/api/v1';
    this.defaultModel = 'openai/gpt-4o-mini';
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

      const model = config.aiModel || this.defaultModel;
      const systemPrompt = config.systemPrompt || 'You are a helpful WhatsApp assistant.';

      // Prepare messages for the API
      const messages = [
        {
          role: 'system',
          content: systemPrompt
        }
      ];

      // Add conversation history (limit to last 10 messages to avoid token limits)
      const recentHistory = conversationHistory.slice(-10);
      for (const msg of recentHistory) {
        messages.push({
          role: msg.sender === 'user' ? 'user' : 'assistant',
          content: msg.content
        });
      }

      // Add current message
      messages.push({
        role: 'user',
        content: message
      });

      const response = await axios.post(`${this.baseUrl}/chat/completions`, {
        model: model,
        messages: messages,
        max_tokens: 500,
        temperature: 0.7,
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
        timeout: 30000
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

      const response = await axios.post(`${this.baseUrl}/chat/completions`, {
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
   * @returns {Promise<Array>} List of available models
   */
  async getAvailableModels() {
    try {
      const config = await memoryService.getConfig();
      
      if (!config || !config.openrouterApiKey) {
        throw new Error('OpenRouter API key not configured');
      }

      const response = await axios.get(`${this.baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${config.openrouterApiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      return response.data.data || [];
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
      const response = await axios.post(`${this.baseUrl}/chat/completions`, {
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