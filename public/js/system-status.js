;(function () {
  const AppStatus = {
    async loadStatus(d) {
      try {
        const response = await fetch('/status')
        if (response.ok) {
          const status = await response.json()
          AppStatus.updateStatusDisplay(d, status)
          d.tunePollingBasedOnAuth(Boolean(status.isAuthenticated))
        }
      } catch (error) {
        console.error('Error loading status:', error)
        AppStatus.updateStatusDisplay(d, {
          wahaConnected: false,
          openrouterConfigured: false,
          messagesProcessed: 0,
          uptime: '0s'
        })
      }
    },

    updateStatusDisplay(d, status) {
      const statusDot = document.querySelector('.status-dot')
      const statusText = document.getElementById('statusText')
      if (statusDot && statusText) {
        const ready = typeof status.systemReady === 'boolean'
          ? status.systemReady
          : (status.wahaConnected && status.openrouterConfigured && status.isAuthenticated)
        if (ready) {
          statusDot.className = 'status-dot connected'
          statusText.textContent = 'System Ready & Authenticated'
        } else if (status.wahaConnected && status.openrouterConfigured) {
          statusDot.className = 'status-dot'
          statusText.textContent = 'Ready - Scan QR Code'
        } else if (status.wahaConnected) {
          statusDot.className = 'status-dot'
          statusText.textContent = 'Partially Ready'
        } else {
          statusDot.className = 'status-dot disconnected'
          statusText.textContent = 'Disconnected'
        }
      }

      const statusElements = {
        wahaStatus: status.wahaConnected ? 'Connected' : 'Disconnected',
        openrouterStatus: status.openrouterConfigured ? 'Configured' : 'Not Configured',
        sessionStatus: AppStatus.getSessionStatusText(status.sessionStatus, status.isAuthenticated),
        messagesCount: status.messagesProcessed || 0
      }
      Object.entries(statusElements).forEach(([id, value]) => {
        const element = document.getElementById(id)
        if (!element) return
        element.textContent = value
        if (id === 'wahaStatus') {
          element.className = `status-value ${status.wahaConnected ? 'connected' : 'disconnected'}`
        } else if (id === 'openrouterStatus') {
          element.className = `status-value ${status.openrouterConfigured ? 'connected' : 'disconnected'}`
        } else if (id === 'sessionStatus') {
          element.className = `status-value ${status.isAuthenticated ? 'connected' : 'disconnected'}`
        } else {
          element.className = 'status-value'
        }
      })

      d.isAuthenticated = Boolean(status.isAuthenticated)
      AppStatus.updateHeroStats(d, status)

      if (!d.isEditingConfig) {
        try {
          const success = document.getElementById('configSuccess')
          const form = document.getElementById('configForm')
          if (success && form) {
            if (status.openrouterConfigured) {
              success.style.display = 'block'
              form.style.display = 'none'
            } else {
              success.style.display = 'none'
              form.style.display = 'block'
            }
          }
        } catch (_) {}
      }

      try {
        const whatsappSuccess = document.getElementById('whatsappSuccess')
        const whatsappConnection = document.getElementById('whatsappConnection')
        if (whatsappSuccess && whatsappConnection) {
          if (status.isAuthenticated) {
            whatsappSuccess.style.display = 'block'
            whatsappConnection.style.display = 'none'
          } else {
            whatsappSuccess.style.display = 'none'
            whatsappConnection.style.display = 'block'
          }
        }
      } catch (_) {}

      if (typeof status.uptimeSeconds === 'number' && !isNaN(status.uptimeSeconds)) {
        AppStatus.startUptimeTicker(d, status.uptimeSeconds)
      } else {
        const up = document.getElementById('uptime')
        if (up && status.uptime) up.textContent = status.uptime
      }
    },

    startUptimeTicker(d, seconds) {
      d.uptimeSeconds = Math.max(0, Math.floor(seconds))
      const el = document.getElementById('uptime')
      if (!el) return
      const render = () => {
        const h = Math.floor(d.uptimeSeconds / 3600)
        const m = Math.floor((d.uptimeSeconds % 3600) / 60)
        el.textContent = `${h}h ${m}m`
      }
      render()
      if (d.uptimeInterval) clearInterval(d.uptimeInterval)
      d.uptimeInterval = setInterval(() => {
        d.uptimeSeconds += 1
        render()
      }, 1000)
    },

    getSessionStatusText(sessionStatus, isAuthenticated) {
      if (isAuthenticated) return 'Authenticated & Ready'
      switch (sessionStatus) {
        case 'STARTING': return 'Starting Session...'
        case 'SCAN_QR_CODE': return 'Waiting for QR Scan'
        case 'WORKING': return 'Authenticated'
        case 'FAILED': return 'Authentication Failed'
        case 'STOPPED': return 'Session Stopped'
        default: return sessionStatus || 'Unknown'
      }
    },

    updateHeroStats(d, status) {
      const heroMessagesCount = document.getElementById('heroMessagesCount')
      const heroUptime = document.getElementById('heroUptime')
      const heroActiveChats = document.getElementById('heroActiveChats')
      if (heroMessagesCount) AppUtils.animateNumber(heroMessagesCount, status.messagesProcessed || 0)
      if (heroUptime) {
        if (typeof status.uptimeSeconds === 'number' && !isNaN(status.uptimeSeconds)) {
          heroUptime.textContent = AppUtils.formatUptime(status.uptimeSeconds)
        } else {
          heroUptime.textContent = status.uptime || '0h 0m'
        }
      }
      if (heroActiveChats) {
        const activeChats = status.activeConversations || AppConversations.getActiveChatsCount()
        AppUtils.animateNumber(heroActiveChats, activeChats)
      }
    },

    tunePollingBasedOnAuth(d, isAuthed) {
      if (d._lastPollingAuthState === isAuthed) return
      d._lastPollingAuthState = isAuthed
      if (d.statusRefreshInterval) clearInterval(d.statusRefreshInterval)
      const interval = isAuthed ? 10000 : 3000
      d.statusRefreshInterval = setInterval(() => d.loadStatus(), interval)
    }
  }

  window.AppStatus = AppStatus
})()

