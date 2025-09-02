;(function () {
  const AppQR = {
    async loadQRCode(d) {
      const qrContainer = document.getElementById('qrContainer')
      if (!qrContainer) return

      try {
        const statusResponse = await fetch('/status')
        if (statusResponse.ok) {
          const status = await statusResponse.json()
          if (status.isAuthenticated) {
            qrContainer.innerHTML = `
                        <div class="success-container" style="text-align: center; padding: 40px 20px;">
                            <div class="success-icon" style="font-size: 64px; color: #10B981; margin-bottom: 20px;">✅</div>
                            <h3 style="color: #10B981; margin-bottom: 10px; font-size: 24px;">Successfully Connected!</h3>
                            <p style="color: #6B7280; margin-bottom: 20px;">Your WhatsApp account is now connected and ready to receive messages.</p>
                            <div class="connection-details" style="background: #F3F4F6; padding: 15px; border-radius: 8px; margin-top: 20px;">
                                <p style="margin: 0; color: #374151; font-size: 14px;">🔐 Session Status: Authenticated</p>
                                <p style="margin: 5px 0 0 0; color: #374151; font-size: 14px;">🤖 WhatsApp Bot is active and monitoring messages</p>
                            </div>
                        </div>
                    `
            const logoutBtn = document.getElementById('logoutBtn')
            const refreshQrBtn = document.getElementById('refreshQr')
            const qrInstructions = document.querySelector('.qr-instructions')
            if (logoutBtn) logoutBtn.style.display = 'inline-block'
            if (refreshQrBtn) refreshQrBtn.style.display = 'none'
            if (qrInstructions) {
              // Hide instructions when authenticated
              qrInstructions.style.display = 'none'
              qrInstructions.style.color = ''
              qrInstructions.style.fontWeight = ''
            }
            return
          }
        }
      } catch (error) {
        console.log('Could not check authentication status:', error)
      }

      qrContainer.innerHTML = `
            <div class="qr-placeholder">
                <div class="loading-spinner"></div>
                <p>Loading QR Code...</p>
            </div>
        `

      try {
        const response = await fetch('/qr')
        const data = await response.json()
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
                `
          const logoutBtn = document.getElementById('logoutBtn')
          const refreshQrBtn = document.getElementById('refreshQr')
          const qrInstructions = document.querySelector('.qr-instructions')
          if (logoutBtn) logoutBtn.style.display = 'none'
          if (refreshQrBtn) {
            refreshQrBtn.style.display = 'inline-block'
            refreshQrBtn.addEventListener('click', () => d.loadQRCode())
          }
          if (qrInstructions) {
            // Preserve existing instructions content; only ensure default styling
            qrInstructions.style.display = ''
            qrInstructions.style.color = ''
            qrInstructions.style.fontWeight = ''
          }
        } else {
          if (data.message && data.message.includes('already connected')) {
            qrContainer.innerHTML = `
                        <div class="success-container" style="text-align: center; padding: 40px 20px;">
                            <div class="success-icon" style="font-size: 64px; color: #10B981; margin-bottom: 20px;">✅</div>
                            <h3 style="color: #10B981; margin-bottom: 10px; font-size: 24px;">Already Connected!</h3>
                            <p style="color: #6B7280; margin-bottom: 20px;">${data.message}</p>
                            <div class="connection-details" style="background: #F3F4F6; padding: 15px; border-radius: 8px; margin-top: 20px;">
                                <p style="margin: 0; color: #374151; font-size: 14px;">🔐 Session Status: Authenticated</p>
                                <p style="margin: 5px 0 0 0; color: #374151; font-size: 14px;">🤖 WhatsApp Bot is active and monitoring messages</p>
                            </div>
                        </div>
                    `
            const logoutBtn = document.getElementById('logoutBtn')
            const refreshQrBtn = document.getElementById('refreshQr')
            const qrInstructions = document.querySelector('.qr-instructions')
            if (logoutBtn) logoutBtn.style.display = 'inline-block'
            if (refreshQrBtn) refreshQrBtn.style.display = 'none'
            if (qrInstructions) {
              // Hide instructions when already connected
              qrInstructions.style.display = 'none'
              qrInstructions.style.color = ''
              qrInstructions.style.fontWeight = ''
            }
          } else {
            qrContainer.innerHTML = `
                        <div class="qr-placeholder">
                            <p>⚠️ ${data.message || 'Failed to load QR code'}</p>
                            <p>Make sure WAHA is running and accessible</p>
                        </div>
                    `
          }
        }
      } catch (error) {
        console.error('Error loading QR code:', error)
        qrContainer.innerHTML = `
                <div class="qr-placeholder">
                    <p>⚠️ Connection Error</p>
                    <p>Unable to connect to WAHA service</p>
                </div>
            `
      }
    }
  }

  window.AppQR = AppQR
})()
