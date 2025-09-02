// Dashboard JavaScript for WhatsApp AI Bot
class WhatsAppBotDashboard {
    constructor() {
        this.qrRefreshInterval = null;
        this.statusRefreshInterval = null;
        this.conversationsRefreshInterval = null;
        this.isAuthenticated = false;
        this.isEditingConfig = false;
        this.sse = null;
        this._models = [];
        this._modelMenuState = { open: false, activeIndex: -1 };
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadConfiguration();
        this.startPeriodicUpdates();
        this.loadQRCode();
        this.loadStatus();
        this.loadConversations();
        this.connectRealtimeUpdates();
        this.initFeatureCards();
    }

    setupEventListeners() {
        // Configuration form
        const configForm = document.getElementById('configForm');
        if (configForm) {
            configForm.addEventListener('submit', (e) => this.handleConfigSubmit(e));
        }

        // Edit configuration button (when already configured)
        const editBtn = document.getElementById('editConfigBtn');
        if (editBtn) {
            editBtn.addEventListener('click', () => {
                this.isEditingConfig = true;
                const success = document.getElementById('configSuccess');
                const form = document.getElementById('configForm');
                if (success) success.style.display = 'none';
                if (form) form.style.display = 'block';
                // Load current config into the form when entering edit mode
                this.loadConfiguration();
            });
        }

        // Cancel edit button
        const cancelBtn = document.getElementById('cancelEditBtn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                this.isEditingConfig = false;
                const success = document.getElementById('configSuccess');
                const form = document.getElementById('configForm');
                if (success) success.style.display = 'block';
                if (form) form.style.display = 'none';
            });
        }

        // QR Code refresh button
        const refreshQrBtn = document.getElementById('refreshQr');
        if (refreshQrBtn) {
            refreshQrBtn.addEventListener('click', () => this.loadQRCode());
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

        // Refresh conversations button
        const refreshConversationsBtn = document.getElementById('refreshConversations');
        if (refreshConversationsBtn) {
            refreshConversationsBtn.addEventListener('click', () => this.loadConversations());
        }

        // Refresh status button
        const refreshStatusBtn = document.getElementById('refreshStatus');
        if (refreshStatusBtn) {
            refreshStatusBtn.addEventListener('click', () => this.loadStatus());
        }

        // Logout button
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => this.handleLogout());
        }

        // Disconnect button
        const disconnectBtn = document.getElementById('disconnectBtn');
        if (disconnectBtn) {
            disconnectBtn.addEventListener('click', () => this.handleLogout());
        }

        // Enhanced form validation and interaction
        this.setupFormValidation();
        this.setupAPIKeyToggle();
        this.setupModelCombobox();
        // Removed Clear Form and Test Connection buttons per request
    }

    setupFormValidation() {
        // API Key validation
        const apiKeyInput = document.getElementById('apiKey');
        if (apiKeyInput) {
            apiKeyInput.addEventListener('input', (e) => {
                this.validateAPIKey(e.target);
                // Debounced fetch of model suggestions when API key changes
                if (!this._debounceModels) this._debounceModels = this.debounce((val) => this.loadModelList(val), 600);
                const val = (e.target.value || '').trim();
                if (val) this._debounceModels(val);
            });
            apiKeyInput.addEventListener('blur', (e) => this.validateAPIKey(e.target));
        }

        // AI Model validation + dynamic suggestions
        const aiModelInput = document.getElementById('aiModel');
        if (aiModelInput) {
            aiModelInput.addEventListener('input', (e) => {
                this.validateAIModel(e.target);
                // Debounced model list refresh when API key is typed
                if (!this._debounceModels) this._debounceModels = this.debounce((val) => this.loadModelList(val), 600);
                const apiKeyVal = (document.getElementById('apiKey')?.value || '').trim();
                if (apiKeyVal) this._debounceModels(apiKeyVal);
            });
            aiModelInput.addEventListener('blur', (e) => this.validateAIModel(e.target));
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
        const apiKeyInput = document.getElementById('apiKey');
        
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
                const payload = await response.json();
                const config = payload?.config || payload;
                this.populateConfigForm(config);
            }
        } catch (error) {
            console.error('Error loading configuration:', error);
            this.showToast('Failed to load configuration', 'error');
        }
    }

    populateConfigForm(config) {
        const elements = {
            'apiKey': config.openrouterApiKey || '',
            'aiModel': config.aiModel || 'openai/gpt-4o-mini',
            'systemPrompt': config.systemPrompt || 'You are a helpful AI assistant for WhatsApp. Be concise and friendly.',
            'wahaUrl': config.wahaUrl || 'http://localhost:3000',
            'sessionName': config.sessionName || 'default'
        };

        Object.entries(elements).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (!element) return;

            if (id === 'apiKey') {
                // If backend indicates the key is configured, don't prefill with mask
                const isMasked = value === '***configured***';
                if (isMasked) {
                    element.value = '';
                    element.placeholder = 'Leave empty to keep existing key';
                    element.removeAttribute('required');
                } else {
                    element.value = value || '';
                    element.setAttribute('required', 'required');
                }
                // Only validate if user-provided (non-empty)
                if (element.value) this.validateAPIKey(element);
            } else {
                element.value = value;
                if (id === 'aiModel') {
                    this.validateAIModel(element);
                    // Load model suggestions using saved API key
                    this.loadModelList();
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

        const submitBtn = document.getElementById('saveConfigBtn');
        const formStatus = document.getElementById('formStatus');
        
        const formData = new FormData(e.target);
        const apiKey = (formData.get('apiKey') || '').trim();
        const config = {
            aiModel: formData.get('aiModel'),
            systemPrompt: formData.get('systemPrompt'),
            wahaUrl: formData.get('wahaUrl'),
            sessionName: formData.get('sessionName')
        };
        if (apiKey) config.openrouterApiKey = apiKey;

        // If user entered an API key, validate it first; otherwise skip validation
        if (apiKey) {
            this.setButtonLoading(submitBtn, true, 'Validating...');
            this.showFormStatus('Validating API key...', 'info');
            try {
                const testResp = await fetch('/config/test-openrouter', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ openrouterApiKey: apiKey })
                });
                const testResult = await testResp.json();
                if (!testResp.ok || !testResult.success) {
                    const msg = testResult.message || 'API key validation failed';
                    this.showToast(`Validation failed: ${msg}`, 'error');
                    this.showFormStatus(`Validation failed: ${msg}`, 'error');
                    this.setButtonState(submitBtn, 'error', 'Validation Failed');
                    setTimeout(() => {
                        this.setButtonLoading(submitBtn, false, 'Save Configuration');
                    }, 2500);
                    return;
                }
            } catch (err) {
                console.error('Error validating API key:', err);
                this.showToast('Failed to validate API key', 'error');
                this.showFormStatus('Validation error occurred', 'error');
                this.setButtonState(submitBtn, 'error', 'Validation Failed');
                setTimeout(() => {
                    this.setButtonLoading(submitBtn, false, 'Save Configuration');
                }, 2500);
                return;
            }
        }

        // Save configuration (either after validation passed or with no API key change)
        try {
            this.setButtonLoading(submitBtn, true, 'Saving...');
            this.showFormStatus('Saving configuration...', 'info');

            const response = await fetch('/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });

            if (response.ok) {
                this.showToast('Configuration saved successfully!', 'success');
                this.showFormStatus('Configuration saved successfully!', 'success');
                this.setButtonState(submitBtn, 'success', 'Saved!');
                this.isEditingConfig = false;
                this.loadStatus();
                setTimeout(() => {
                    this.setButtonLoading(submitBtn, false, 'Save Configuration');
                    this.hideFormStatus();
                }, 2000);
            } else {
                const error = await response.json();
                this.showToast(`Failed to save configuration: ${error.message}`, 'error');
                this.showFormStatus(`Error: ${error.message}`, 'error');
                this.setButtonState(submitBtn, 'error', 'Save Failed');
                setTimeout(() => {
                    this.setButtonLoading(submitBtn, false, 'Save Configuration');
                }, 3000);
            }
        } catch (error) {
            console.error('Error validating/saving configuration:', error);
            this.showToast('Failed to validate or save configuration', 'error');
            this.showFormStatus('Network error occurred', 'error');
            this.setButtonState(submitBtn, 'error', 'Network Error');
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
                    
                    // Show logout button and hide refresh QR button when authenticated
                    const logoutBtn = document.getElementById('logoutBtn');
                    const refreshQrBtn = document.getElementById('refreshQr');
                    const qrInstructions = document.querySelector('.qr-instructions');
                    
                    if (logoutBtn) logoutBtn.style.display = 'inline-block';
                    if (refreshQrBtn) refreshQrBtn.style.display = 'none';
                    if (qrInstructions) {
                        qrInstructions.textContent = '';
                        qrInstructions.style.color = '';
                        qrInstructions.style.fontWeight = '';
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
                const logoutBtn = document.getElementById('logoutBtn');
                const refreshQrBtn = document.getElementById('refreshQr');
                const qrInstructions = document.querySelector('.qr-instructions');
                
                if (logoutBtn) logoutBtn.style.display = 'none';
                if (refreshQrBtn) {
                    refreshQrBtn.style.display = 'inline-block';
                    // Re-attach event listener for refresh button
                    refreshQrBtn.addEventListener('click', () => this.loadQRCode());
                }
                if (qrInstructions) {
                    qrInstructions.innerHTML = 'Scan this QR code with your WhatsApp to connect the bot';
                    qrInstructions.style.color = '';
                    qrInstructions.style.fontWeight = '';
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
                    
                    // Show logout button and hide refresh QR button for already connected state
                    const logoutBtn = document.getElementById('logoutBtn');
                    const refreshQrBtn = document.getElementById('refreshQr');
                    const qrInstructions = document.querySelector('.qr-instructions');
                    
                    if (logoutBtn) logoutBtn.style.display = 'inline-block';
                    if (refreshQrBtn) refreshQrBtn.style.display = 'none';
                    if (qrInstructions) {
                        qrInstructions.textContent = '';
                        qrInstructions.style.color = '';
                        qrInstructions.style.fontWeight = '';
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
                this.tunePollingBasedOnAuth(Boolean(status.isAuthenticated));
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
        const statusText = document.getElementById('statusText');
        
        if (statusDot && statusText) {
            const ready = (typeof status.systemReady === 'boolean')
                ? status.systemReady
                : (status.wahaConnected && status.openrouterConfigured && status.isAuthenticated);
            if (ready) {
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
            'messagesCount': status.messagesProcessed || 0
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

        // track auth state for polling adjustments
        this.isAuthenticated = Boolean(status.isAuthenticated);

        // Update hero section stats
        this.updateHeroStats(status);

        // Toggle config UI based on whether AI is configured, unless editing
        if (!this.isEditingConfig) {
            try {
                const success = document.getElementById('configSuccess');
                const form = document.getElementById('configForm');
                if (success && form) {
                    if (status.openrouterConfigured) {
                        success.style.display = 'block';
                        form.style.display = 'none';
                    } else {
                        success.style.display = 'none';
                        form.style.display = 'block';
                    }
                }
            } catch (_) {}
        }

        // Toggle WhatsApp UI based on connection status
        try {
            const whatsappSuccess = document.getElementById('whatsappSuccess');
            const whatsappConnection = document.getElementById('whatsappConnection');
            if (whatsappSuccess && whatsappConnection) {
                if (status.isAuthenticated) {
                    whatsappSuccess.style.display = 'block';
                    whatsappConnection.style.display = 'none';
                } else {
                    whatsappSuccess.style.display = 'none';
                    whatsappConnection.style.display = 'block';
                }
            }
        } catch (_) {}

        // Live uptime update: prefer numeric seconds if available
        if (typeof status.uptimeSeconds === 'number' && !isNaN(status.uptimeSeconds)) {
            this.startUptimeTicker(status.uptimeSeconds);
        } else {
            // Fallback to server string
            const up = document.getElementById('uptime');
            if (up && status.uptime) up.textContent = status.uptime;
        }
    }

    startUptimeTicker(seconds) {
        this.uptimeSeconds = Math.max(0, Math.floor(seconds));
        const el = document.getElementById('uptime');
        if (!el) return;
        const render = () => {
            const h = Math.floor(this.uptimeSeconds / 3600);
            const m = Math.floor((this.uptimeSeconds % 3600) / 60);
            el.textContent = `${h}h ${m}m`;
        };
        render();
        if (this.uptimeInterval) clearInterval(this.uptimeInterval);
        this.uptimeInterval = setInterval(() => {
            this.uptimeSeconds += 1;
            render();
        }, 1000);
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
                let conversations = data.conversations || data; // May be an object map
                if (conversations && !Array.isArray(conversations) && typeof conversations === 'object') {
                    conversations = Object.entries(conversations).map(([userId, conv]) => ({ userId, ...(conv || {}) }));
                }
                if (Array.isArray(conversations)) {
                    conversations.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
                }
                this.displayConversations(Array.isArray(conversations) ? conversations : []);
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

        // Start with faster status polling; slow down after auth
        this.statusRefreshInterval = setInterval(() => {
            this.loadStatus();
        }, 3000);

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

    tunePollingBasedOnAuth(isAuthed) {
        if (this._lastPollingAuthState === isAuthed) return;
        this._lastPollingAuthState = isAuthed;
        if (this.statusRefreshInterval) {
            clearInterval(this.statusRefreshInterval);
        }
        const interval = isAuthed ? 10000 : 3000;
        this.statusRefreshInterval = setInterval(() => this.loadStatus(), interval);
    }

    connectRealtimeUpdates() {
        try {
            const es = new EventSource('/events');
            this.sse = es;
            es.onmessage = (e) => {
                if (!e.data) return;
                let data;
                try { data = JSON.parse(e.data); } catch { return; }
                this.handleRealtimeEvent(data);
            };
            es.onerror = () => {
                try { es.close(); } catch {}
                // Exponential backoff up to 30s
                this._sseRetry = Math.min((this._sseRetry || 2000) * 2, 30000);
                setTimeout(() => this.connectRealtimeUpdates(), this._sseRetry);
            };
        } catch (err) {
            console.warn('Realtime updates unavailable:', err);
        }
    }

    handleRealtimeEvent(evt) {
        const type = evt?.type || '';
        const payload = evt?.payload || {};
        if (type === 'session.status') {
            if (payload.status === 'WORKING') {
                this.isAuthenticated = true;
                this.tunePollingBasedOnAuth(true);
                this.showToast('WhatsApp connected', 'success');
                this.loadQRCode();
                this.loadStatus();
            } else if (payload.status === 'SCAN_QR_CODE' || payload.status === 'STARTING') {
                this.isAuthenticated = false;
                this.tunePollingBasedOnAuth(false);
                this.loadQRCode();
            }
        } else if (type === 'ready' || type === 'auth') {
            this.isAuthenticated = true;
            this.tunePollingBasedOnAuth(true);
            this.loadQRCode();
            this.loadStatus();
        } else if (type === 'qr') {
            this.isAuthenticated = false;
            this.tunePollingBasedOnAuth(false);
            this.loadQRCode();
        } else if (type === 'message' || type === 'message.any') {
            // On new messages, refresh conversations list
            this.loadConversations();
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
            // If field is not required (existing key present), an empty value is acceptable
            if (!input.hasAttribute('required')) {
                isValid = true;
                message = 'Using existing saved API key';
            } else {
                message = 'API key is required';
            }
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
    
    validateAIModel(input) {
        const value = (input.value || '').trim();
        const isValid = value.length > 0;
        const message = isValid ? 'Model set' : 'Enter a model ID (e.g., openai/gpt-4o-mini)';
        this.updateValidationState(input, isValid, message);
        return isValid;
    }
    
    validateSystemPrompt(textarea) {
        const value = textarea.value.trim();
        const wrapper = textarea.closest('.form-group');
        const charCounter = wrapper?.querySelector('.char-counter');
        const isValid = value.length <= 500; // Allow empty values, just check max length
        
        let message = '';
        if (value.length > 500) {
            message = 'System prompt must be less than 500 characters';
        } else {
            message = value.length === 0 ? 'System prompt is optional' : 'Valid system prompt';
        }
        
        // Update character counter
        if (charCounter) {
            charCounter.textContent = `${value.length}/500`;
            charCounter.className = `char-counter ${value.length > 500 ? 'over-limit' : ''}`;
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
        const apiKeyInput = document.getElementById('apiKey');
        const aiModelSelect = document.getElementById('aiModel');
        const systemPromptTextarea = document.getElementById('systemPrompt');
        
        // Only require API key validation if field is required or non-empty
        const apiKeyValid = apiKeyInput.hasAttribute('required')
            ? this.validateAPIKey(apiKeyInput)
            : (apiKeyInput.value.trim() ? this.validateAPIKey(apiKeyInput) : true);
        const aiModelValid = this.validateAIModel(aiModelSelect);
        const systemPromptValid = this.validateSystemPrompt(systemPromptTextarea);
        
        return apiKeyValid && aiModelValid && systemPromptValid;
    }

    // Fetch model IDs from backend and populate custom combobox list
    async loadModelList(apiKeyOverride = '') {
        try {
            const url = apiKeyOverride
                ? `/openrouter/models?apiKey=${encodeURIComponent(apiKeyOverride)}`
                : '/openrouter/models';
            const resp = await fetch(url);
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || !data.success) {
                // Silent fail to avoid noisy UX; user can still type
                return;
            }
            const list = Array.isArray(data.models) ? data.models : [];
            // Store for custom combobox rendering
            this._models = list;
            // If menu is open or input focused, refresh suggestions
            const input = document.getElementById('aiModel');
            if (input && (document.activeElement === input)) {
                this.renderModelMenu(input.value);
            }
        } catch (_) {
            // Ignore errors; the field remains writable
        }
    }

    // Simple debounce utility
    debounce(fn, wait = 300) {
        let t;
        return (...args) => {
            clearTimeout(t);
            t = setTimeout(() => fn.apply(this, args), wait);
        };
    }

    // --- Custom combobox for AI Model ---
    setupModelCombobox() {
        const input = document.getElementById('aiModel');
        const menu = document.getElementById('aiModelMenu');
        if (!input || !menu) return;

        // Open and render on focus/input
        input.addEventListener('focus', () => {
            this.renderModelMenu(input.value);
            this.showModelMenu();
        });
        input.addEventListener('input', () => {
            this.renderModelMenu(input.value);
            this.showModelMenu();
        });

        // Keyboard navigation
        input.addEventListener('keydown', (e) => {
            if (!this._models || !this._models.length) return;
            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    this.moveActive(1);
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    this.moveActive(-1);
                    break;
                case 'Enter':
                    if (this._modelMenuState.open) {
                        e.preventDefault();
                        this.selectActive();
                    }
                    break;
                case 'Escape':
                    this.hideModelMenu();
                    break;
            }
        });

        // Hide on blur (delay to allow click)
        input.addEventListener('blur', () => setTimeout(() => this.hideModelMenu(), 120));

        // Click selection
        menu.addEventListener('mousedown', (e) => {
            const item = e.target.closest('.combo-item');
            if (!item) return;
            e.preventDefault();
            input.value = item.dataset.value || '';
            this.validateAIModel(input);
            this.hideModelMenu();
        });
    }

    filterModels(query) {
        const q = (query || '').toLowerCase().trim();
        const list = Array.isArray(this._models) ? this._models : [];
        if (!q) return list.slice(0, 20);
        return list.filter(id => id.toLowerCase().includes(q)).slice(0, 20);
    }

    renderModelMenu(query) {
        const menu = document.getElementById('aiModelMenu');
        const input = document.getElementById('aiModel');
        if (!menu || !input) return;

        const matches = this.filterModels(query);
        menu.innerHTML = '';
        this._modelMenuState.activeIndex = -1;

        if (!matches.length) {
            const empty = document.createElement('div');
            empty.className = 'combo-empty';
            empty.textContent = 'No models found';
            menu.appendChild(empty);
            return;
        }

        matches.forEach((id, idx) => {
            const div = document.createElement('div');
            div.className = 'combo-item';
            div.setAttribute('role', 'option');
            div.dataset.value = id;
            // Split provider/model for subtle styling
            const parts = id.split('/');
            const provider = parts[0] || '';
            const model = parts.slice(1).join('/') || '';
            div.innerHTML = `<span class="provider">${provider}</span>${model ? '/' : ''}<span class="model">${model}</span>`;
            if (idx === 0) div.classList.add('active');
            menu.appendChild(div);
        });

        this._modelMenuState.activeIndex = matches.length ? 0 : -1;
        input.setAttribute('aria-expanded', 'true');
    }

    showModelMenu() {
        const menu = document.getElementById('aiModelMenu');
        const input = document.getElementById('aiModel');
        if (!menu || !input) return;
        menu.hidden = false;
        this._modelMenuState.open = true;
        input.setAttribute('aria-expanded', 'true');
    }

    hideModelMenu() {
        const menu = document.getElementById('aiModelMenu');
        const input = document.getElementById('aiModel');
        if (!menu || !input) return;
        menu.hidden = true;
        this._modelMenuState.open = false;
        this._modelMenuState.activeIndex = -1;
        input.setAttribute('aria-expanded', 'false');
    }

    moveActive(delta) {
        const menu = document.getElementById('aiModelMenu');
        if (!menu || menu.hidden) return;
        const items = Array.from(menu.querySelectorAll('.combo-item'));
        if (!items.length) return;
        let idx = this._modelMenuState.activeIndex;
        idx = (idx + delta + items.length) % items.length;
        items.forEach(el => el.classList.remove('active'));
        items[idx].classList.add('active');
        this._modelMenuState.activeIndex = idx;
        // Ensure visibility
        const active = items[idx];
        const mRect = menu.getBoundingClientRect();
        const aRect = active.getBoundingClientRect();
        if (aRect.bottom > mRect.bottom) menu.scrollTop += (aRect.bottom - mRect.bottom);
        if (aRect.top < mRect.top) menu.scrollTop -= (mRect.top - aRect.top);
    }

    selectActive() {
        const menu = document.getElementById('aiModelMenu');
        const input = document.getElementById('aiModel');
        if (!menu || !input) return;
        const items = Array.from(menu.querySelectorAll('.combo-item'));
        if (!items.length) return;
        const idx = this._modelMenuState.activeIndex >= 0 ? this._modelMenuState.activeIndex : 0;
        const val = items[idx].dataset.value || '';
        input.value = val;
        this.validateAIModel(input);
        this.hideModelMenu();
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
                charCounter.textContent = '0/500';
                charCounter.className = 'char-counter';
            }
            
            this.hideFormStatus();
            this.showToast('Form cleared', 'info');
        }
    }
    
    async testConnection() {
        const testBtn = document.getElementById('testConnection');
        const apiKeyInput = document.getElementById('apiKey');
        
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

    async handleLogout() {
        console.log('[UI] Logout button clicked');
        this.showToast('Attempting to logout...', 'info');
        // Support both primary logout and alternate disconnect buttons
        const logoutBtn = document.getElementById('logoutBtn');
        const disconnectBtn = document.getElementById('disconnectBtn');
        const targetBtn = logoutBtn || disconnectBtn;
        if (!targetBtn) {
            console.warn('[UI] No logout/disconnect button found in DOM');
            // Still attempt backend logout
        }
        // Proceed without native confirm to avoid environment blocking dialogs
        // If you want confirmation, implement a custom in-page modal instead

        // Show loading state
        const btnText = targetBtn ? targetBtn.querySelector('.btn-text') : null;
        const btnLoading = targetBtn ? targetBtn.querySelector('.btn-loading') : null;
        
        if (btnText) btnText.style.display = 'none';
        if (btnLoading) btnLoading.style.display = 'inline-flex';
        if (targetBtn) {
            targetBtn.disabled = true;
            targetBtn.classList.add('loading'); // Add loading class to disable pointer events
        }

        try {
            const response = await fetch('/api/sessions/default/logout', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const result = await response.json().catch(() => ({}));

            if (response.ok) {
                this.showToast('Successfully logged out from WhatsApp', 'success');
                console.log('[UI] Logout successful', result);
                
                // Hide logout button and show refresh QR button
                if (logoutBtn) logoutBtn.style.display = 'none';
                if (disconnectBtn) disconnectBtn.style.display = 'none';
                const refreshQrBtn = document.getElementById('refreshQr');
                if (refreshQrBtn) {
                    refreshQrBtn.style.display = 'inline-block';
                }
                
                // Refresh QR code and status
                await this.loadQRCode();
                await this.loadStatus();
            } else {
                console.error('[UI] Logout failed response', result);
                this.showToast(`Logout failed: ${result.message || 'Unknown error'}`, 'error');
            }
        } catch (error) {
            console.error('Error during logout:', error);
            this.showToast('Failed to logout. Please try again.', 'error');
        } finally {
            // Reset button state
            if (btnText) btnText.style.display = 'inline-flex';
            if (btnLoading) btnLoading.style.display = 'none';
            if (targetBtn) {
                targetBtn.disabled = false;
                targetBtn.classList.remove('loading'); // Remove loading class to restore clickability
            }
        }
    }

    // Update hero section statistics
    updateHeroStats(status) {
        const heroMessagesCount = document.getElementById('heroMessagesCount');
        const heroUptime = document.getElementById('heroUptime');
        const heroActiveChats = document.getElementById('heroActiveChats');

        if (heroMessagesCount) {
            this.animateNumber(heroMessagesCount, status.messagesProcessed || 0);
        }

        if (heroUptime) {
            if (typeof status.uptimeSeconds === 'number' && !isNaN(status.uptimeSeconds)) {
                heroUptime.textContent = this.formatUptime(status.uptimeSeconds);
            } else {
                heroUptime.textContent = status.uptime || '0h 0m';
            }
        }

        if (heroActiveChats) {
            // Calculate active chats from conversations or use a default
            const activeChats = status.activeConversations || this.getActiveChatsCount();
            this.animateNumber(heroActiveChats, activeChats);
        }
    }

    // Animate numbers with a counting effect
    animateNumber(element, targetNumber) {
        const currentNumber = parseInt(element.textContent) || 0;
        const difference = targetNumber - currentNumber;
        const increment = Math.ceil(Math.abs(difference) / 20) || 1;
        
        if (difference === 0) return;
        
        let current = currentNumber;
        const timer = setInterval(() => {
            if (difference > 0) {
                current += increment;
                if (current >= targetNumber) {
                    current = targetNumber;
                    clearInterval(timer);
                }
            } else {
                current -= increment;
                if (current <= targetNumber) {
                    current = targetNumber;
                    clearInterval(timer);
                }
            }
            element.textContent = current.toLocaleString();
        }, 50);
    }

    // Format uptime from seconds to readable format
    formatUptime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        } else if (minutes > 0) {
            return `${minutes}m ${secs}s`;
        } else {
            return `${secs}s`;
        }
    }

    // Get active chats count from conversations list
    getActiveChatsCount() {
        const conversationsContainer = document.getElementById('conversationsContainer');
        if (conversationsContainer) {
            const conversations = conversationsContainer.querySelectorAll('.conversation-item');
            return conversations.length;
        }
        return 0;
    }

    // Initialize feature cards animations
    initFeatureCards() {
        const featureCards = document.querySelectorAll('.feature-card');
        
        featureCards.forEach((card, index) => {
            // Add staggered animation on page load
            card.style.opacity = '0';
            card.style.transform = 'translateY(20px)';
            
            setTimeout(() => {
                card.style.transition = 'all 0.6s ease';
                card.style.opacity = '1';
                card.style.transform = 'translateY(0)';
            }, 100 + (index * 150));

            // Add hover sound effect (visual feedback)
            card.addEventListener('mouseenter', () => {
                card.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
            });

            // Add click animation
            card.addEventListener('click', () => {
                card.style.transform = 'scale(0.98)';
                setTimeout(() => {
                    card.style.transform = '';
                }, 150);

                // Show a "coming soon" toast
                const title = card.querySelector('.feature-title').textContent;
                this.showToast(`${title} is coming soon! Stay tuned for updates.`, 'info');
            });
        });
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
