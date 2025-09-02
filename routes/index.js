const { register: registerRoot } = require('./root');
const { register: registerQR } = require('./qr');
const { register: registerConfig } = require('./config');
const { register: registerStatus } = require('./status');
const { register: registerSessions } = require('./sessions');
const { register: registerWebhook } = require('./webhook');
const sseHub = require('../lib/sseHub');

function registerRoutes(app, config, helpers) {
  // SSE first so clients can connect
  sseHub.register(app, config);

  registerRoot(app);
  registerQR(app);
  registerConfig(app);
  registerStatus(app, helpers);
  registerSessions(app);
  registerWebhook(app);
}

module.exports = { registerRoutes };

