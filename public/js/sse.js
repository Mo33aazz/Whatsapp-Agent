;(function () {
  const AppSSE = {
    connectRealtimeUpdates(d) {
      try {
        const es = new EventSource('/events')
        d.sse = es
        es.onmessage = (e) => {
          if (!e.data) return
          let data
          try { data = JSON.parse(e.data) } catch { return }
          AppSSE.handleRealtimeEvent(d, data)
        }
        es.onerror = () => {
          try { es.close() } catch {}
          d._sseRetry = Math.min((d._sseRetry || 2000) * 2, 30000)
          setTimeout(() => AppSSE.connectRealtimeUpdates(d), d._sseRetry)
        }
      } catch (err) {
        console.warn('Realtime updates unavailable:', err)
      }
    },

    handleRealtimeEvent(d, evt) {
      const type = (evt && evt.type) || ''
      const payload = (evt && evt.payload) || {}
      if (type === 'session.status') {
        if (payload.status === 'WORKING') {
          d.isAuthenticated = true
          d.tunePollingBasedOnAuth(true)
          d.showToast('WhatsApp connected', 'success')
          d.loadQRCode()
          d.loadStatus()
        } else if (payload.status === 'SCAN_QR_CODE' || payload.status === 'STARTING') {
          d.isAuthenticated = false
          d.tunePollingBasedOnAuth(false)
          d.loadQRCode()
        }
      } else if (type === 'ready' || type === 'auth') {
        d.isAuthenticated = true
        d.tunePollingBasedOnAuth(true)
        d.loadQRCode()
        d.loadStatus()
      } else if (type === 'qr') {
        d.isAuthenticated = false
        d.tunePollingBasedOnAuth(false)
        d.loadQRCode()
      } else if (type === 'message' || type === 'message.any') {
        d.loadConversations()
      }
    }
  }

  window.AppSSE = AppSSE
})()

