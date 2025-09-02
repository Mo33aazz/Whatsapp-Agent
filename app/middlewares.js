const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

function applyMiddlewares(app, config) {
  if (config.security.helmetEnabled) {
    app.use(helmet());
  }

  app.use(cors({
    origin: config.security.corsOrigin === '*' ? true : config.security.corsOrigin
  }));

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  const rootDir = path.join(__dirname, '..');
  app.use(express.static(path.join(rootDir, 'public')));

  const limiter = rateLimit({
    windowMs: config.security.rateLimit.windowMs,
    max: config.security.rateLimit.max,
    message: {
      success: false,
      error: 'Too many requests, please try again later.'
    }
  });
  app.use((req, res, next) => {
    const p = req.path || '';
    if (p === '/events' || p === '/waha-events' || p === '/webhook' || p === '/health') return next();
    return limiter(req, res, next);
  });

  // Logging middleware
  app.use((req, res, next) => {
    if (logger.isLevelEnabled('DEBUG')) {
      logger.debug('HTTP', `${req.method} ${req.path}`);
    }
    next();
  });
}

module.exports = { applyMiddlewares };

