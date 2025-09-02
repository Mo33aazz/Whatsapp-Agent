const logger = require('../utils/logger');
const wahaService = require('../services/wahaService');

function register(app) {
  app.get('/qr', async (req, res) => {
    try {
      const result = await wahaService.getQRCode();
      
      // If result indicates already connected, return it as success
      if (result && result.success) {
        return res.json({
          success: true,
          alreadyConnected: true,
          message: result.message || 'WhatsApp is already connected',
          user: result.user
        });
      }
      
      // Otherwise return QR code as before
      res.json({ success: true, qrCode: result });
    } catch (error) {
      logger.error('QR', 'Error getting QR code', error);

      if (error.message && error.message.toLowerCase().includes('locked')) {
        try {
          logger.info('QR', 'QR requested while session locked. Auto-unlocking and retrying...');
          if (typeof wahaService.unlockLogout === 'function') wahaService.unlockLogout();
          const result = await wahaService.getQRCode();
          
          // Check if unlock resulted in already connected
          if (result && result.success) {
            return res.json({
              success: true,
              alreadyConnected: true,
              message: result.message || 'WhatsApp is already connected',
              user: result.user,
              unlocked: true
            });
          }
          
          return res.json({ success: true, qrCode: result, unlocked: true });
        } catch (retryErr) {
          logger.warning('QR', 'Retry after unlock failed', retryErr);
          return res.status(409).json({
            success: false,
            message: 'Session was locked and retry failed. Please try again.',
            locked: true
          });
        }
      }

      res.status(500).json({ success: false, error: error.message });
    }
  });
}

module.exports = { register };

