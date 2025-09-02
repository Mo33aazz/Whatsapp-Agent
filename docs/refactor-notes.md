Refactor Summary (Backend modularization)

Date: ${new Date().toISOString()}

Overview:
- Extracted middlewares, SSE hub, and all routes from `server.js` into dedicated modules.
- Preserved all endpoint paths, behaviors, and side effects.

New Structure:
- app/middlewares.js — applies helmet, CORS, parsers, static, rate limit, and debug logging.
- lib/sseHub.js — central SSE client registry and broadcast function; mounts GET /events.
- routes/index.js — registers all route modules in consistent order.
- routes/root.js — GET / (serves public/index.html).
- routes/qr.js — GET /qr.
- routes/config.js — GET/POST /config, GET/POST /log-level, OpenRouter test/model endpoints.
- routes/status.js — GET /status, GET/DELETE /conversations, GET /health.
- routes/sessions.js — DELETE /api/sessions/:session, POST /api/sessions/:session/logout.
- routes/webhook.js — POST [/waha-events, /webhook], POST /waha-events-dup-disabled, GET/POST /debug-webhook, POST /configure-webhook.

Server Orchestration:
- `server.js` now builds the app via middlewares + route registration and manages startup/init, uptime persistence, and graceful shutdown.
- Uptime base carried via `uptimeBaseSecondsRef` for accurate cross-restart accumulation.

Behavior Preservation:
- All original paths retained; request/response shapes unchanged.
- Rate limit exclusions (/events, /waha-events, /webhook, /health) preserved.
- SSE behavior and heartbeat preserved; broadcast now in `lib/sseHub`.
- Error middleware and 404 handler order preserved.

Notes:
- No external/public API changes.
- No new dependencies.

