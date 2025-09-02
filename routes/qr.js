const logger = require('../utils/logger');
const wahaService = require('../services/wahaService');

function register(app) {
  app.get('/qr', async (req, res) => {
    try {
      const qrCode = await wahaService.getQRCode();
      res.json({ success: true, qrCode });
    } catch (error) {
      logger.error('QR', 'Error getting QR code', error);

      if (error.message && error.message.includes('already connected')) {
        return res.json({ success: false, message: error.message, alreadyConnected: true });
      }
      if (error.message && error.message.toLowerCase().includes('locked')) {
        try {
          logger.info('QR', 'QR requested while session locked. Auto-unlocking and retrying...');
          if (typeof wahaService.unlockLogout === 'function') wahaService.unlockLogout();
          const qrCode = await wahaService.getQRCode();
          return res.json({ success: true, qrCode, unlocked: true });
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

