// Dashboard JavaScript for WhatsApp AI Bot
class WhatsAppBotDashboard {
    constructor() {
        this.qrRefreshInterval = null;
        this.statusRefreshInterval = null;
        this.conversationsRefreshInterval = null;
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadConfiguration();
        this.startPeriodicUpdates();
        this.loadQRCode();
        this.loadStatus();
        this.loadConversations();
    }

    setupEventListeners() {
        // Configuration form
        const configForm = document.getElementById('configForm');
        if (configForm) {
            configForm.addEventListener('submit', (e) => this.handleConfigSubmit(e));
        }

        // QR Code refresh button
        const refreshQRBtn = document.getElementById('refreshQR');
        if (refreshQRBtn) {
            refreshQRBtn.addEventListener('click', () => this.loadQRCode());
        }

        // Test API button
        const testAPIBtn = document.getElementById('testAPI');
        if (testAPIBtn) {
            testAPIBtn.addEventListener('click', () => this.testOpenRouterAPI());
        }

        // Clear conversations button
        const clearConversationsBtn = document.getElementById('clearConversations');
        if (clearConversationsBtn) {
            clearConversationsBtn.addEventListener('click', () => this.clearConversations());
        }

        // Refresh status button
        const refreshStatusBtn = document.getElementById('refreshStatus');
        if (refreshStatusBtn) {
            refreshStatusBtn.addEventListener('click', () => this.loadStatus());
        }

        // Enhanced form validation and interaction
        this.setupFormValidation();
        this.setupAPIKeyToggle();
        this.setupClearFormButton();
        this.setupTestConnectionButton();
    }

    setupFormValidation() {
        // API Key validation
        const apiKeyInput = document.getElementById('openrouterApiKey');
        if (apiKeyInput) {
            apiKeyInput.addEventListener('input', (e) => this.validateAPIKey(e.target));
            apiKeyInput.addEventListener('blur', (e) => this.validateAPIKey(e.target));
        }

        // AI Model validation
        const aiModelSelect = document.getElementById('aiModel');
        if (aiModelSelect) {
            aiModelSelect.addEventListener('change', (e) => this.validateAIModel(e.target));
        }

        // System Prompt validation
        const systemPromptTextarea = document.getElementById('systemPrompt');
        if (systemPromptTextarea) {
            systemPromptTextarea.addEventListener('input', (e) => this.validateSystemPrompt(e.target));
            systemPromptTextarea.addEventListener('blur', (e) => this.validateSystemPrompt(e.target));
        }
    }

    setupAPIKeyToggle() {
        const toggleBtn = document.getElementById('toggleApiKey');
        const apiKeyInput = document.getElementById('openrouterApiKey');
        
        if (toggleBtn && apiKeyInput) {
            toggleBtn.addEventListener('click', () => {
                const isPassword = apiKeyInput.type === 'password';
                apiKeyInput.type = isPassword ? 'text' : 'password';
                toggleBtn.innerHTML = isPassword ? '<i class="fas fa-eye-slash"></i>' : '<i class="fas fa-eye"></i>';
            });
        }
    }

    setupClearFormButton() {
        const clearBtn = document.getElementById('clearForm');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clearForm());
        }
    }

    setupTestConnectionButton() {
        const testConnBtn = document.getElementById('testConnection');
        if (testConnBtn) {
            testConnBtn.addEventListener('click', () => this.testConnection());
        }
    }

    async loadConfiguration() {
        try {
            const response = await fetch('/config');
            if (response.ok) {
                const config = await response.json();
                this.populateConfigForm(config);
            }
        } catch (error) {
            console.error('Error loading configuration:', error);
            this.showToast('Failed to load configuration', 'error');
        }
    }

    populateConfigForm(config) {
        const elements = {
            'openrouterApiKey': config.openrouterApiKey || '',
            'aiModel': config.aiModel || 'openai/gpt-4o-mini',
            'systemPrompt': config.systemPrompt || 'You are a helpful AI assistant for WhatsApp. Be concise and friendly.',
            'wahaUrl': config.wahaUrl || 'http://localhost:3000',
            'sessionName': config.sessionName || 'default'
        };

        Object.entries(elements).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) {
                element.value = value;
                // Trigger validation for populated fields
                if (id === 'openrouterApiKey') {
                    this.validateAPIKey(element);
                } else if (id === 'aiModel') {
                    this.validateAIModel(element);
                } else if (id === 'systemPrompt') {
                    this.validateSystemPrompt(element);
                }
            }
        });
    }

    async handleConfigSubmit(e) {
        e.preventDefault();
        
        // Validate form before submission
        if (!this.validateForm()) {
            this.showToast('Please fix validation errors before submitting', 'error');
            return;
        }

        const submitBtn = document.getElementById('saveConfig');
        const formStatus = document.getElementById('formStatus');
        
        // Show loading state
        this.setButtonLoading(submitBtn, true, 'Saving...');
        this.showFormStatus('Saving configuration...', 'info');
        
        const formData = new FormData(e.target);
        const config = {
            openrouterApiKey: formData.get('openrouterApiKey'),
            aiModel: formData.get('aiModel'),
            systemPrompt: formData.get('systemPrompt'),
            wahaUrl: formData.get('wahaUrl'),
            sessionName: formData.get('sessionName')
        };

        try {
            const response = await fetch('/config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(config)
            });

            if (response.ok) {
                this.showToast('Configuration saved successfully!', 'success');
                this.showFormStatus('Configuration saved successfully!', 'success');
                this.setButtonState(submitBtn, 'success', 'Saved!');
                this.loadStatus(); // Refresh status after config change
                
                // Reset button state after 2 seconds
                setTimeout(() => {
                    this.setButtonLoading(submitBtn, false, 'Save Configuration');
                    this.hideFormStatus();
                }, 2000);
            } else {
                const error = await response.json();
                this.showToast(`Failed to save configuration: ${error.message}`, 'error');
                this.showFormStatus(`Error: ${error.message}`, 'error');
                this.setButtonState(submitBtn, 'error', 'Save Failed');
                
                // Reset button state after 3 seconds
                setTimeout(() => {
                    this.setButtonLoading(submitBtn, false, 'Save Configuration');
                }, 3000);
            }
        } catch (error) {
            console.error('Error saving configuration:', error);
            this.showToast('Failed to save configuration', 'error');
            this.showFormStatus('Network error occurred', 'error');
            this.setButtonState(submitBtn, 'error', 'Network Error');
            
            // Reset button state after 3 seconds
            setTimeout(() => {
                this.setButtonLoading(submitBtn, false, 'Save Configuration');
            }, 3000);
        }
    }

    async loadQRCode() {
        const qrContainer = document.getElementById('qrContainer');
        if (!qrContainer) return;

        // First check if session is authenticated
        try {
            const statusResponse = await fetch('/status');
            if (statusResponse.ok) {
                const status = await statusResponse.json();
                if (status.isAuthenticated) {
                    // Show success message instead of QR code
                    qrContainer.innerHTML = `
                        <div class="success-container" style="text-align: center; padding: 40px 20px;">
                            <div class="success-icon" style="font-size: 64px; color: #10B981; margin-bottom: 20px;">✅</div>
                            <h3 style="color: #10B981; margin-bottom: 10px; font-size: 24px;">Successfully Connected!</h3>
                            <p style="color: #6B7280; margin-bottom: 20px;">Your WhatsApp account is now connected and ready to receive messages.</p>
                            <div class="connection-details" style="background: #F3F4F6; padding: 15px; border-radius: 8px; margin-top: 20px;">
                                <p style="margin: 0; color: #374151; font-size: 14px;">🟢 Session Status: Authenticated</p>
                                <p style="margin: 5px 0 0 0; color: #374151; font-size: 14px;">📱 WhatsApp Bot is active and monitoring messages</p>
                            </div>
                        </div>
                    `;
                    
                    // Hide the refresh QR button and update instructions when authenticated
                    const qrActions = document.querySelector('.qr-actions');
                    if (qrActions) {
                        qrActions.innerHTML = `
                            <p class="connection-success-text" style="color: #10B981; font-weight: 500; margin: 0;">✅ WhatsApp connection established successfully</p>
                        `;
                    }
                    return;
                }
            }
        } catch (error) {
            console.log('Could not check authentication status:', error);
        }

        // Show loading state
        qrContainer.innerHTML = `
            <div class="qr-placeholder">
                <div class="loading-spinner"></div>
                <p>Loading QR Code...</p>
            </div>
        `;

        try {
            const response = await fetch('/qr');
            const data = await response.json();

            if (response.ok && data.qrCode) {
                qrContainer.innerHTML = `
                    <img src="${data.qrCode}" alt="WhatsApp QR Code" class="qr-image" />
                    <div class="qr-instructions">
                        <p>Scan this QR code with WhatsApp to connect your account</p>
                        <p><strong>Steps:</strong></p>
                        <ol style="text-align: left; margin-top: 10px;">
                            <li>Open WhatsApp on your phone</li>
                            <li>Go to Settings → Linked Devices</li>
                            <li>Tap "Link a Device"</li>
                            <li>Scan this QR code</li>
                        </ol>
                    </div>
                `;
                
                // Restore QR actions when not authenticated
                const qrActions = document.querySelector('.qr-actions');
                if (qrActions) {
                    qrActions.innerHTML = `
                        <button id="refreshQr" class="btn btn-secondary">Refresh QR Code</button>
                        <p class="qr-instructions">Scan this QR code with your WhatsApp to connect the bot</p>
                    `;
                    // Re-attach event listener for refresh button
                    const refreshQRBtn = document.getElementById('refreshQr');
                    if (refreshQRBtn) {
                        refreshQRBtn.addEventListener('click', () => this.loadQRCode());
                    }
                }
            } else {
                // Check if the error message indicates already connected
                if (data.message && data.message.includes('already connected')) {
                    // Show success message for already connected
                    qrContainer.innerHTML = `
                        <div class="success-container" style="text-align: center; padding: 40px 20px;">
                            <div class="success-icon" style="font-size: 64px; color: #10B981; margin-bottom: 20px;">✅</div>
                            <h3 style="color: #10B981; margin-bottom: 10px; font-size: 24px;">Already Connected!</h3>
                            <p style="color: #6B7280; margin-bottom: 20px;">${data.message}</p>
                            <div class="connection-details" style="background: #F3F4F6; padding: 15px; border-radius: 8px; margin-top: 20px;">
                                <p style="margin: 0; color: #374151; font-size: 14px;">🟢 Session Status: Authenticated</p>
                                <p style="margin: 5px 0 0 0; color: #374151; font-size: 14px;">📱 WhatsApp Bot is active and monitoring messages</p>
                            </div>
                        </div>
                    `;
                    
                    // Update QR actions for already connected state
                    const qrActions = document.querySelector('.qr-actions');
                    if (qrActions) {
                        qrActions.innerHTML = `
                            <p class="connection-success-text" style="color: #10B981; font-weight: 500; margin: 0;">✅ WhatsApp connection established successfully</p>
                        `;
                    }
                } else {
                    qrContainer.innerHTML = `
                        <div class="qr-placeholder">
                            <p>❌ ${data.message || 'Failed to load QR code'}</p>
                            <p>Make sure WAHA is running and accessible</p>
                        </div>
                    `;
                }
            }
        } catch (error) {
            console.error('Error loading QR code:', error);
            qrContainer.innerHTML = `
                <div class="qr-placeholder">
                    <p>❌ Connection Error</p>
                    <p>Unable to connect to WAHA service</p>
                </div>
            `;
        }
    }

    async loadStatus() {
        try {
            const response = await fetch('/status');
            if (response.ok) {
                const status = await response.json();
                this.updateStatusDisplay(status);
            }
        } catch (error) {
            console.error('Error loading status:', error);
            this.updateStatusDisplay({
                wahaConnected: false,
                openrouterConfigured: false,
                messagesProcessed: 0,
                uptime: '0s'
            });
        }
    }

    updateStatusDisplay(status) {
        // Update main status indicator
        const statusDot = document.querySelector('.status-dot');
        const statusText = document.querySelector('.status-text');
        
        if (statusDot && statusText) {
            if (status.wahaConnected && status.openrouterConfigured && status.isAuthenticated) {
                statusDot.className = 'status-dot connected';
                statusText.textContent = 'System Ready & Authenticated';
            } else if (status.wahaConnected && status.openrouterConfigured) {
                statusDot.className = 'status-dot';
                statusText.textContent = 'Ready - Scan QR Code';
            } else if (status.wahaConnected) {
                statusDot.className = 'status-dot';
                statusText.textContent = 'Partially Ready';
            } else {
                statusDot.className = 'status-dot disconnected';
                statusText.textContent = 'Disconnected';
            }
        }

        // Update individual status items
        const statusElements = {
            'wahaStatus': status.wahaConnected ? 'Connected' : 'Disconnected',
            'openrouterStatus': status.openrouterConfigured ? 'Configured' : 'Not Configured',
            'sessionStatus': this.getSessionStatusText(status.sessionStatus, status.isAuthenticated),
            'messagesCount': status.messagesProcessed || 0,
            'systemUptime': status.uptime || '0s'
        };

        Object.entries(statusElements).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = value;
                
                // Add status classes
                if (id === 'wahaStatus') {
                    element.className = `status-value ${status.wahaConnected ? 'connected' : 'disconnected'}`;
                } else if (id === 'openrouterStatus') {
                    element.className = `status-value ${status.openrouterConfigured ? 'connected' : 'disconnected'}`;
                } else if (id === 'sessionStatus') {
                    element.className = `status-value ${status.isAuthenticated ? 'connected' : 'disconnected'}`;
                } else {
                    element.className = 'status-value';
                }
            }
        });
    }

    getSessionStatusText(sessionStatus, isAuthenticated) {
        if (isAuthenticated) {
            return 'Authenticated & Ready';
        }
        
        switch (sessionStatus) {
            case 'STARTING':
                return 'Starting Session...';
            case 'SCAN_QR_CODE':
                return 'Waiting for QR Scan';
            case 'WORKING':
                return 'Authenticated';
            case 'FAILED':
                return 'Authentication Failed';
            case 'STOPPED':
                return 'Session Stopped';
            default:
                return sessionStatus || 'Unknown';
        }
    }

    async loadConversations() {
        const conversationsContainer = document.getElementById('conversationsContainer');
        if (!conversationsContainer) return;

        try {
            const response = await fetch('/conversations');
            if (response.ok) {
                const data = await response.json();
                const conversations = data.conversations || data; // Handle both response formats
                this.displayConversations(conversations);
            } else {
                conversationsContainer.innerHTML = '<div class="loading-placeholder">Failed to load conversations</div>';
            }
        } catch (error) {
            console.error('Error loading conversations:', error);
            conversationsContainer.innerHTML = '<div class="loading-placeholder">Error loading conversations</div>';
        }
    }

    displayConversations(conversations) {
        const conversationsContainer = document.getElementById('conversationsContainer');
        if (!conversationsContainer) return;

        if (!conversations || conversations.length === 0) {
            conversationsContainer.innerHTML = '<div class="loading-placeholder">No conversations yet</div>';
            return;
        }

        const conversationsHTML = conversations.map(conv => {
            const lastMessage = conv.messages && conv.messages.length > 0 
                ? conv.messages[conv.messages.length - 1]
                : null;
            
            const lastMessageText = lastMessage 
                ? (lastMessage.content || lastMessage.text || 'No message content')
                : 'No messages';
            
            const lastMessageTime = lastMessage 
                ? new Date(lastMessage.timestamp).toLocaleString()
                : 'Unknown';

            return `
                <div class="conversation-item">
                    <div class="conversation-info">
                        <div class="conversation-user">${conv.userId || 'Unknown User'}</div>
                        <div class="conversation-last-message">${lastMessageText.substring(0, 100)}${lastMessageText.length > 100 ? '...' : ''}</div>
                    </div>
                    <div class="conversation-meta">
                        <div>${conv.messages ? conv.messages.length : 0} messages</div>
                        <div>${lastMessageTime}</div>
                    </div>
                </div>
            `;
        }).join('');

        conversationsContainer.innerHTML = conversationsHTML;
    }

    async testOpenRouterAPI() {
        const testAPIBtn = document.getElementById('testAPI');
        if (testAPIBtn) {
            testAPIBtn.disabled = true;
            testAPIBtn.textContent = 'Testing...';
        }

        try {
            const response = await fetch('/config/test-openrouter', {
                method: 'POST'
            });

            const result = await response.json();
            
            if (response.ok && result.success) {
                this.showToast('OpenRouter API test successful!', 'success');
            } else {
                this.showToast(`API test failed: ${result.message}`, 'error');
            }
        } catch (error) {
            console.error('Error testing API:', error);
            this.showToast('Failed to test OpenRouter API', 'error');
        } finally {
            if (testAPIBtn) {
                testAPIBtn.disabled = false;
                testAPIBtn.textContent = 'Test API';
            }
        }
    }

    async clearConversations() {
        if (!confirm('Are you sure you want to clear all conversations? This action cannot be undone.')) {
            return;
        }

        try {
            const response = await fetch('/conversations', {
                method: 'DELETE'
            });

            if (response.ok) {
                this.showToast('Conversations cleared successfully!', 'success');
                this.loadConversations();
                this.loadStatus(); // Refresh message count
            } else {
                const error = await response.json();
                this.showToast(`Failed to clear conversations: ${error.message}`, 'error');
            }
        } catch (error) {
            console.error('Error clearing conversations:', error);
            this.showToast('Failed to clear conversations', 'error');
        }
    }

    startPeriodicUpdates() {
        // Refresh QR code every 30 seconds
        this.qrRefreshInterval = setInterval(() => {
            this.loadQRCode();
        }, 30000);

        // Refresh status every 10 seconds
        this.statusRefreshInterval = setInterval(() => {
            this.loadStatus();
        }, 10000);

        // Refresh conversations every 15 seconds
        this.conversationsRefreshInterval = setInterval(() => {
            this.loadConversations();
        }, 15000);
    }

    stopPeriodicUpdates() {
        if (this.qrRefreshInterval) {
            clearInterval(this.qrRefreshInterval);
        }
        if (this.statusRefreshInterval) {
            clearInterval(this.statusRefreshInterval);
        }
        if (this.conversationsRefreshInterval) {
            clearInterval(this.conversationsRefreshInterval);
        }
    }

    showToast(message, type = 'info') {
        const toastContainer = document.getElementById('toastContainer');
        if (!toastContainer) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;

        toastContainer.appendChild(toast);

        // Auto remove after 5 seconds
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 5000);
    }

    // Enhanced validation methods
    validateAPIKey(input) {
        const value = input.value.trim();
        const wrapper = input.closest('.input-wrapper');
        const validationMsg = wrapper?.querySelector('.validation-message');
        const strengthIndicator = wrapper?.querySelector('.api-key-strength');
        const validationIcon = wrapper?.querySelector('.validation-icon');
        
        let isValid = false;
        let message = '';
        let strength = 'weak';
        
        if (!value) {
            message = 'API key is required';
        } else if (!value.startsWith('sk-or-v1-') && !value.startsWith('sk-')) {
            message = 'API key must start with "sk-or-v1-" or "sk-"';
        } else if (value.length < 20) {
            message = 'API key appears to be too short';
        } else {
            isValid = true;
            message = 'Valid API key format';
            
            // Determine strength based on length and format
            if (value.length >= 50) {
                strength = 'strong';
            } else if (value.length >= 30) {
                strength = 'medium';
            }
        }
        
        this.updateValidationState(input, isValid, message);
        this.updateAPIKeyStrength(strengthIndicator, strength, isValid);
        
        return isValid;
    }
    
    validateAIModel(select) {
        const value = select.value;
        const isValid = value && value !== '';
        const message = isValid ? 'Model selected' : 'Please select an AI model';
        
        this.updateValidationState(select, isValid, message);
        return isValid;
    }
    
    validateSystemPrompt(textarea) {
        const value = textarea.value.trim();
        const wrapper = textarea.closest('.form-group');
        const charCounter = wrapper?.querySelector('.char-counter');
        const isValid = value.length >= 10 && value.length <= 1000;
        
        let message = '';
        if (!value) {
            message = 'System prompt is required';
        } else if (value.length < 10) {
            message = 'System prompt must be at least 10 characters';
        } else if (value.length > 1000) {
            message = 'System prompt must be less than 1000 characters';
        } else {
            message = 'Valid system prompt';
        }
        
        // Update character counter
        if (charCounter) {
            charCounter.textContent = `${value.length}/1000`;
            charCounter.className = `char-counter ${value.length > 1000 ? 'over-limit' : ''}`;
        }
        
        this.updateValidationState(textarea, isValid, message);
        return isValid;
    }
    
    updateValidationState(element, isValid, message) {
        const wrapper = element.closest('.input-wrapper') || element.closest('.form-group');
        const validationMsg = wrapper?.querySelector('.validation-message');
        const validationIcon = wrapper?.querySelector('.validation-icon');
        
        // Update input classes
        element.classList.remove('valid', 'invalid');
        element.classList.add(isValid ? 'valid' : 'invalid');
        
        // Update validation message
        if (validationMsg) {
            validationMsg.textContent = message;
            validationMsg.className = `validation-message ${isValid ? 'success' : 'error'}`;
        }
        
        // Update validation icon
        if (validationIcon) {
            validationIcon.innerHTML = isValid ? '<i class="fas fa-check"></i>' : '<i class="fas fa-times"></i>';
            validationIcon.className = `validation-icon ${isValid ? 'success' : 'error'}`;
        }
    }
    
    updateAPIKeyStrength(indicator, strength, isValid) {
        if (!indicator) return;
        
        indicator.className = `api-key-strength ${isValid ? strength : 'weak'}`;
        
        const strengthText = indicator.querySelector('.strength-text');
        if (strengthText) {
            if (!isValid) {
                strengthText.textContent = 'Invalid';
            } else {
                strengthText.textContent = strength.charAt(0).toUpperCase() + strength.slice(1);
            }
        }
    }
    
    validateForm() {
        const apiKeyInput = document.getElementById('openrouterApiKey');
        const aiModelSelect = document.getElementById('aiModel');
        const systemPromptTextarea = document.getElementById('systemPrompt');
        
        const apiKeyValid = this.validateAPIKey(apiKeyInput);
        const aiModelValid = this.validateAIModel(aiModelSelect);
        const systemPromptValid = this.validateSystemPrompt(systemPromptTextarea);
        
        return apiKeyValid && aiModelValid && systemPromptValid;
    }
    
    clearForm() {
        if (!confirm('Are you sure you want to clear all form data?')) {
            return;
        }
        
        const form = document.getElementById('configForm');
        if (form) {
            form.reset();
            
            // Reset validation states
            const inputs = form.querySelectorAll('input, select, textarea');
            inputs.forEach(input => {
                input.classList.remove('valid', 'invalid');
                const wrapper = input.closest('.input-wrapper') || input.closest('.form-group');
                const validationMsg = wrapper?.querySelector('.validation-message');
                const validationIcon = wrapper?.querySelector('.validation-icon');
                
                if (validationMsg) validationMsg.textContent = '';
                if (validationIcon) validationIcon.innerHTML = '';
            });
            
            // Reset API key strength indicator
            const strengthIndicator = document.querySelector('.api-key-strength');
            if (strengthIndicator) {
                strengthIndicator.className = 'api-key-strength weak';
                const strengthText = strengthIndicator.querySelector('.strength-text');
                if (strengthText) strengthText.textContent = 'Weak';
            }
            
            // Reset character counter
            const charCounter = document.querySelector('.char-counter');
            if (charCounter) {
                charCounter.textContent = '0/1000';
                charCounter.className = 'char-counter';
            }
            
            this.hideFormStatus();
            this.showToast('Form cleared', 'info');
        }
    }
    
    async testConnection() {
        const testBtn = document.getElementById('testConnection');
        const apiKeyInput = document.getElementById('openrouterApiKey');
        
        if (!this.validateAPIKey(apiKeyInput)) {
            this.showToast('Please enter a valid API key first', 'warning');
            return;
        }
        
        this.setButtonLoading(testBtn, true, 'Testing...');
        this.showFormStatus('Testing API connection...', 'info');
        
        try {
            const response = await fetch('/config/test-openrouter', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    openrouterApiKey: apiKeyInput.value
                })
            });
            
            const result = await response.json();
            
            if (response.ok && result.success) {
                this.showToast('API connection test successful!', 'success');
                this.showFormStatus('API connection verified!', 'success');
                this.setButtonState(testBtn, 'success', 'Connected!');
            } else {
                this.showToast(`API test failed: ${result.message}`, 'error');
                this.showFormStatus(`Test failed: ${result.message}`, 'error');
                this.setButtonState(testBtn, 'error', 'Test Failed');
            }
        } catch (error) {
            console.error('Error testing connection:', error);
            this.showToast('Failed to test API connection', 'error');
            this.showFormStatus('Connection test failed', 'error');
            this.setButtonState(testBtn, 'error', 'Test Failed');
        } finally {
            setTimeout(() => {
                this.setButtonLoading(testBtn, false, 'Test Connection');
                this.hideFormStatus();
            }, 3000);
        }
    }
    
    setButtonLoading(button, loading, text) {
        if (!button) return;
        
        if (loading) {
            button.disabled = true;
            button.classList.add('loading');
            button.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${text}`;
        } else {
            button.disabled = false;
            button.classList.remove('loading', 'success', 'error');
            button.innerHTML = text;
        }
    }
    
    setButtonState(button, state, text) {
        if (!button) return;
        
        button.classList.remove('loading', 'success', 'error');
        button.classList.add(state);
        
        const icon = state === 'success' ? 'check' : 'times';
        button.innerHTML = `<i class="fas fa-${icon}"></i> ${text}`;
    }
    
    showFormStatus(message, type) {
        const formStatus = document.getElementById('formStatus');
        if (formStatus) {
            formStatus.textContent = message;
            formStatus.className = `form-status ${type}`;
            formStatus.style.display = 'block';
        }
    }
    
    hideFormStatus() {
        const formStatus = document.getElementById('formStatus');
        if (formStatus) {
            formStatus.style.display = 'none';
        }
    }

    destroy() {
        this.stopPeriodicUpdates();
    }
}

// Initialize dashboard when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.dashboard = new WhatsAppBotDashboard();
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (window.dashboard) {
        window.dashboard.destroy();
    }
});