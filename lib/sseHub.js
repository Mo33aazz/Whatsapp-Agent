const logger = require('../utils/logger');

const sseClients = new Set();

function register(app, config) {
  app.get('/events', (req, res) => {
    try { req.socket.setTimeout(0); } catch (_) {}
    try { req.socket.setNoDelay(true); } catch (_) {}
    try { req.socket.setKeepAlive(true); } catch (_) {}

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (config.security.corsOrigin === '*') {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.flushHeaders && res.flushHeaders();

    try { res.write(': connected\n\n'); } catch (_) {}

    sseClients.add(res);

    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch (_) {}
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
      try { res.end(); } catch (_) {}
    });
  });
}

function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (err) {
      try { client.end(); } catch (_) {}
      sseClients.delete(client);
      try { logger.debug('SSE', 'Dropped SSE client on write failure'); } catch (_) {}
    }
  }
}

module.exports = { register, broadcast };

