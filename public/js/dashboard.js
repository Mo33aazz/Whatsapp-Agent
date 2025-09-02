// Orchestrator class delegating behavior to smaller modules
;(function () {
  class WhatsAppBotDashboard {
    constructor() {
      this.qrRefreshInterval = null
      this.statusRefreshInterval = null
      this.conversationsRefreshInterval = null
      this.isAuthenticated = false
      this.isEditingConfig = false
      this.sse = null
      this._models = []
      this._modelMenuState = { open: false, activeIndex: -1 }
      this.init()
    }

    init() {
      this.setupEventListeners()
      this.loadConfiguration()
      this.startPeriodicUpdates()
      this.loadQRCode()
      this.loadStatus()
      this.loadConversations()
      this.connectRealtimeUpdates()
      this.initFeatureCards()
    }

    setupEventListeners() {
      const configForm = document.getElementById('configForm')
      if (configForm) configForm.addEventListener('submit', (e) => this.handleConfigSubmit(e))

      const editBtn = document.getElementById('editConfigBtn')
      if (editBtn) {
        editBtn.addEventListener('click', () => {
          this.isEditingConfig = true
          const success = document.getElementById('configSuccess')
          const form = document.getElementById('configForm')
          if (success) success.style.display = 'none'
          if (form) form.style.display = 'block'
          this.loadConfiguration()
        })
      }

      const cancelBtn = document.getElementById('cancelEditBtn')
      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
          this.isEditingConfig = false
          const success = document.getElementById('configSuccess')
          const form = document.getElementById('configForm')
          if (success) success.style.display = 'block'
          if (form) form.style.display = 'none'
        })
      }

      const forceRestartBtn = document.getElementById('forceRestart')
      if (forceRestartBtn) forceRestartBtn.addEventListener('click', () => this.forceRestart())

      const testAPIBtn = document.getElementById('testAPI')
      if (testAPIBtn) testAPIBtn.addEventListener('click', () => this.testOpenRouterAPI())

      const clearConversationsBtn = document.getElementById('clearConversations')
      if (clearConversationsBtn) clearConversationsBtn.addEventListener('click', () => this.clearConversations())
      const clearConversationsHeaderBtn = document.getElementById('clearConversationsHeader')
      if (clearConversationsHeaderBtn) clearConversationsHeaderBtn.addEventListener('click', () => this.clearConversations())

      const refreshConversationsBtn = document.getElementById('refreshConversations')
      if (refreshConversationsBtn) refreshConversationsBtn.addEventListener('click', () => this.loadConversations())

      const refreshStatusBtn = document.getElementById('refreshStatus')
      if (refreshStatusBtn) refreshStatusBtn.addEventListener('click', () => this.loadStatus())

      const logoutBtn = document.getElementById('logoutBtn')
      if (logoutBtn) logoutBtn.addEventListener('click', () => this.handleLogout())

      const disconnectBtn = document.getElementById('disconnectBtn')
      if (disconnectBtn) disconnectBtn.addEventListener('click', () => this.handleLogout())

      this.setupFormValidation()
      this.setupAPIKeyToggle()
      this.setupModelCombobox()
    }

    // Delegations to modules
    setupFormValidation() { return window.AppConfig.setupFormValidation(this) }
    setupAPIKeyToggle() { return window.AppConfig.setupAPIKeyToggle(this) }
    setupClearFormButton() { const btn = document.getElementById('clearForm'); if (btn) btn.addEventListener('click', () => this.clearForm()) }
    setupTestConnectionButton() { const btn = document.getElementById('testConnection'); if (btn) btn.addEventListener('click', () => this.testConnection()) }

    async loadConfiguration() { return window.AppConfig.loadConfiguration(this) }
    populateConfigForm(config) { return window.AppConfig.populateConfigForm(this, config) }
    async handleConfigSubmit(e) { return window.AppConfig.handleConfigSubmit(this, e) }

    async loadQRCode() { return window.AppQR.loadQRCode(this) }
    async loadStatus() { return window.AppStatus.loadStatus(this) }
    updateStatusDisplay(status) { return window.AppStatus.updateStatusDisplay(this, status) }
    startUptimeTicker(seconds) { return window.AppStatus.startUptimeTicker(this, seconds) }
    getSessionStatusText(sessionStatus, isAuthenticated) { return window.AppStatus.getSessionStatusText(sessionStatus, isAuthenticated) }

    async loadConversations() { return window.AppConversations.loadConversations(this) }
    displayConversations(conversations) { return window.AppConversations.displayConversations(this, conversations) }
    async clearConversations() { return window.AppConversations.clearConversations(this) }

    async testOpenRouterAPI() { return window.AppConfig.testOpenRouterAPI(this) }
    async testConnection() { return window.AppConfig.testConnection(this) }

    startPeriodicUpdates() {
      this.qrRefreshInterval = setInterval(() => { this.loadQRCode() }, 30000)
      this.statusRefreshInterval = setInterval(() => { this.loadStatus() }, 3000)
      this.conversationsRefreshInterval = setInterval(() => { this.loadConversations() }, 15000)
    }
    stopPeriodicUpdates() {
      if (this.qrRefreshInterval) clearInterval(this.qrRefreshInterval)
      if (this.statusRefreshInterval) clearInterval(this.statusRefreshInterval)
      if (this.conversationsRefreshInterval) clearInterval(this.conversationsRefreshInterval)
    }
    tunePollingBasedOnAuth(isAuthed) { return window.AppStatus.tunePollingBasedOnAuth(this, isAuthed) }

    connectRealtimeUpdates() { return window.AppSSE.connectRealtimeUpdates(this) }
    handleRealtimeEvent(evt) { return window.AppSSE.handleRealtimeEvent(this, evt) }

    showToast(message, type = 'info') { return window.AppUtils.showToast(message, type) }
    setButtonLoading(button, loading, text) { return window.AppUtils.setButtonLoading(button, loading, text) }
    setButtonState(button, state, text) { return window.AppUtils.setButtonState(button, state, text) }
    showFormStatus(message, type) { return window.AppUtils.showFormStatus(message, type) }
    hideFormStatus() { return window.AppUtils.hideFormStatus() }

    updateHeroStats(status) { return window.AppStatus.updateHeroStats(this, status) }
    animateNumber(element, targetNumber) { return window.AppUtils.animateNumber(element, targetNumber) }
    formatUptime(seconds) { return window.AppUtils.formatUptime(seconds) }

    // Keep debounce as instance-bound to preserve `this`
    debounce(fn, wait = 300) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), wait) } }

    // Model combobox helpers
    setupModelCombobox() { return window.AppConfig.setupModelCombobox(this) }
    loadModelList(apiKeyOverride = '') { return window.AppConfig.loadModelList(this, apiKeyOverride) }
    filterModels(query) { return window.AppConfig.filterModels(this, query) }
    renderModelMenu(query) { return window.AppConfig.renderModelMenu(this, query) }
    showModelMenu() { return window.AppConfig.showModelMenu(this) }
    hideModelMenu() { return window.AppConfig.hideModelMenu(this) }
    moveActive(delta) { return window.AppConfig.moveActive(this, delta) }
    selectActive() { return window.AppConfig.selectActive(this) }

    // Conversations helpers
    getActiveChatsCount() { return window.AppConversations.getActiveChatsCount() }

    // Features
    initFeatureCards() { return window.AppFeatures.initFeatureCards(this) }

    // Logout logic (preserved)
    async handleLogout() {
      console.log('[UI] Logout button clicked')
      this.showToast('Attempting to logout...', 'info')
      const logoutBtn = document.getElementById('logoutBtn')
      const disconnectBtn = document.getElementById('disconnectBtn')
      const targetBtn = logoutBtn || disconnectBtn
      if (!targetBtn) {
        console.warn('[UI] No logout/disconnect button found in DOM')
      }
      const btnText = targetBtn ? targetBtn.querySelector('.btn-text') : null
      const btnLoading = targetBtn ? targetBtn.querySelector('.btn-loading') : null
      if (btnText) btnText.style.display = 'none'
      if (btnLoading) btnLoading.style.display = 'inline-flex'
      if (targetBtn) { targetBtn.disabled = true; targetBtn.classList.add('loading') }
      try {
        const response = await fetch('/api/sessions/default/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
        const result = await response.json().catch(() => ({}))
        if (response.ok) {
          this.showToast('Successfully logged out from WhatsApp', 'success')
          console.log('[UI] Logout successful', result)
          if (logoutBtn) logoutBtn.style.display = 'none'
          if (disconnectBtn) disconnectBtn.style.display = 'none'
          // Keep Force restart button visible at all times
          await this.loadQRCode()
          await this.loadStatus()
        } else {
          console.error('[UI] Logout failed response', result)
          this.showToast(`Logout failed: ${result.message || 'Unknown error'}`, 'error')
        }
      } catch (error) {
        console.error('Error during logout:', error)
        this.showToast('Failed to logout. Please try again.', 'error')
      } finally {
        if (btnText) btnText.style.display = 'inline-flex'
        if (btnLoading) btnLoading.style.display = 'none'
        if (targetBtn) { targetBtn.disabled = false; targetBtn.classList.remove('loading') }
      }
    }

    // Force restart session via server API
    async forceRestart() {
      const btn = document.getElementById('forceRestart')
      try {
        this.showToast('Forcing session restart...', 'info')
        this.setButtonLoading(btn, true, 'Restarting...')
        const res = await fetch('/api/sessions/default/restart', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          this.showToast(`Restart failed: ${data.message || data.error || 'Unknown error'}`, 'error')
          return
        }
        this.showToast('Session restart triggered successfully', 'success')
        // Refresh QR and status after restart
        await this.loadQRCode()
        await this.loadStatus()
      } catch (e) {
        console.error('Force restart error', e)
        this.showToast('Failed to trigger restart. Please try again.', 'error')
      } finally {
        this.setButtonLoading(btn, false, 'Force restart')
      }
    }

    destroy() { this.stopPeriodicUpdates() }
  }

  window.WhatsAppBotDashboard = WhatsAppBotDashboard
  document.addEventListener('DOMContentLoaded', () => { window.dashboard = new WhatsAppBotDashboard() })
  window.addEventListener('beforeunload', () => { if (window.dashboard) window.dashboard.destroy() })
})()
