const axios = require('axios');
const http = require('http');
const https = require('https');

// Reusable HTTP(S) agents with keep-alive to cut TLS and TCP handshakes
const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 10_000,
  maxSockets: 100,
  maxFreeSockets: 10,
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 10_000,
  maxSockets: 100,
  maxFreeSockets: 10,
});

const client = axios.create({
  // Defer per-request timeouts; these are sensible defaults
  timeout: 15_000,
  httpAgent,
  httpsAgent,
  // Accept gzip/deflate; axios handles decompression
  headers: {
    'Accept-Encoding': 'gzip, deflate, br',
  },
  transitional: {
    clarifyTimeoutError: true,
  },
});

module.exports = client;

