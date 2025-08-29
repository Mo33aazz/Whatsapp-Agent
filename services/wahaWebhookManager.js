const httpClient = require('../utils/httpClient');

class WAHAWebhookManager {
  constructor(baseURL, sessionName) {
    this.baseURL = baseURL;
    this.sessionName = sessionName;
    this._webhookEnsuredFor = new Set();
    this._webhookMonitorStartedFor = new Set();
    this._ensureInFlight = new Map();
  }

  // Webhook URL helpers
  getEventsWebhookUrl() {
    const explicit = process.env.WAHA_EVENTS_WEBHOOK_URL || process.env.EVENTS_WEBHOOK_URL;
    if (explicit) return explicit;

    const base = process.env.PUBLIC_BASE_URL;
    if (base) return `${base.replace(/\/$/, '')}/waha-events`;

    // Default to host.docker.internal for WAHA running in Docker
    return `http://host.docker.internal:3001/waha-events`;
  }

  getCandidateWebhookUrls() {
    const explicit = process.env.WAHA_EVENTS_WEBHOOK_URL || process.env.EVENTS_WEBHOOK_URL;
    if (explicit) return [explicit];

    const base = process.env.PUBLIC_BASE_URL;
    if (base) return [`${base.replace(/\/$/, '')}/waha-events`];

    // Default: prefer host.docker.internal for Docker WAHA
    return [
      `http://host.docker.internal:3001/waha-events`
    ];
  }

  getRequiredEvents() {
    // Ensure these exact four events are registered
    return ['message', 'session.status', 'state.change', 'message.any'];
  }

  // Webhook configuration
  async configureWebhook(webhookUrl, eventsParam) {
    try {
      const events = Array.isArray(eventsParam) && eventsParam.length
        ? eventsParam
        : this.getRequiredEvents();
      const webhookData = {
        url: webhookUrl,
        events,
        hmac: null,
        retries: { policy: "constant", delaySeconds: 2, attempts: 3 }
      };
      
      await httpClient.post(`${this.baseURL}/api/sessions/${this.sessionName}/webhooks`, webhookData, {
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' }
      });
      
      console.log('Webhook configured successfully');
    } catch (error) {
      console.error('Webhook configuration error:', error.message);
      throw error;
    }
  }

  async configureWahaEventsWebhook() {
    try {
      const webhookUrl = this.getEventsWebhookUrl();
      const requiredEvents = this.getRequiredEvents();
      const webhookData = {
        url: webhookUrl,
        events: requiredEvents,
        hmac: null,
        retries: { policy: "constant", delaySeconds: 2, attempts: 3 }
      };
      
      await httpClient.post(`${this.baseURL}/api/sessions/${this.sessionName}/webhooks`, webhookData, {
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' }
      });
      
      console.log('WAHA events webhook configured successfully to:', webhookUrl);
    } catch (error) {
      console.error('WAHA events webhook configuration error:', error.message);
      throw error;
    }
  }

  // Webhook monitoring
  startWebhookAuthMonitor(sessionName, getSessionInfoFn, sleepFn) {
    const sess = sessionName || this.sessionName || 'default';
    if (this._webhookMonitorStartedFor.has(sess)) return;
    this._webhookMonitorStartedFor.add(sess);

    (async () => {
      const startTs = Date.now();
      const timeoutMs = 10 * 60 * 1000;
      const pollIntervalMs = 2000;
      const ensureRetryDelayMs = 3000;
      const maxEnsureAttempts = 3;
      let ensureAttempts = 0;
      let lastStatus = '';
      let stableWorkingCount = 0;
      
      console.log(`Starting webhook auth monitor for session '${sess}'`);
      
      try {
        while (Date.now() - startTs < timeoutMs) {
          try {
            const info = await getSessionInfoFn(sess);
            const status = info?.data?.status || 'UNKNOWN';
            
            if (status !== lastStatus) {
              lastStatus = status;
              console.log(`Session '${sess}' status: ${status}`);
            }
            
            // Require two consecutive WORKING/AUTHENTICATED polls to consider it stable
            if (status === 'WORKING' || status === 'AUTHENTICATED') {
              stableWorkingCount += 1;
            } else {
              stableWorkingCount = 0;
            }

            if (stableWorkingCount >= 2) {
              let ensured = false;
              while (!ensured && ensureAttempts < maxEnsureAttempts) {
                ensureAttempts++;
                try {
                  const res = await this.ensureWebhookConfigured(sess, getSessionInfoFn, sleepFn);
                  ensured = !!res?.ensured;
                  if (ensured) break;
                } catch (e) {
                  console.error(`Ensure webhook attempt ${ensureAttempts} failed:`, e.message);
                }
                await sleepFn(ensureRetryDelayMs);
              }
              
              // If not ensured after attempts, verify if it already exists and assume configured
              if (!ensured) {
                try {
                  const candidateUrls = this.getCandidateWebhookUrls();
                  const assumed = await this._verifyWebhookConfig(sess, candidateUrls, getSessionInfoFn)
                    || await this._verifyWebhookViaEndpoint(sess, candidateUrls);
                  if (assumed) {
                    ensured = true;
                    this._webhookEnsuredFor.add(sess);
                    console.log(`Webhook appears already configured for '${sess}'; assuming ensured after ${ensureAttempts} attempts.`);
                  }
                } catch (_) {}
              }

              if (ensured) {
                console.log(`Webhook ensured for session '${sess}' after ${ensureAttempts} attempt(s).`);
              } else {
                console.warn(`Webhook not ensured for session '${sess}' after ${ensureAttempts} attempts.`);
              }
              break;
            }
            
            if (status === 'FAILED' || status === 'STOPPED') break;
          } catch (e) {
            // Ignore transient errors during polling
          }
          
          await sleepFn(pollIntervalMs);
        }
      } finally {
        this._webhookMonitorStartedFor.delete(sess);
        console.log(`Webhook auth monitor finished for session '${sess}'`);
      }
    })();
  }

  // Webhook configuration ensuring
  async ensureWebhookConfigured(sessionName, getSessionInfoFn, sleepFn, waitForStartCompletionFn) {
    const sess = sessionName || this.sessionName || 'default';
    const candidateUrls = this.getCandidateWebhookUrls();
    const requiredEvents = this.getRequiredEvents();

    // Wait for any start operations to complete
    if (waitForStartCompletionFn) {
      await waitForStartCompletionFn(sess, sleepFn);
    }

    // Only ensure webhooks when session is authenticated
    const sessionStatus = await this._getAuthenticatedSessionStatus(sess, getSessionInfoFn);
    if (!sessionStatus.isAuthenticated) {
      return { ensured: false, session: sess, deferred: true, reason: sessionStatus.reason };
    }

    // De-dupe concurrent ensure attempts per session
    if (this._ensureInFlight.has(sess)) {
      try {
        return await this._ensureInFlight.get(sess);
      } catch (_) {
        // fallthrough to new attempt
      }
    }

    // Check cache and verify webhook still exists
    if (await this._isWebhookCached(sess, candidateUrls, requiredEvents)) {
      return { ensured: true, session: sess, cached: true };
    }

    // Try multiple configuration methods
    // Important: avoid PUT /api/sessions/{sess} which can restart/stop the session.
    const methods = [
      () => this._configureViaWebhooksEndpoint(sess, candidateUrls, requiredEvents),
      () => this._configureViaConfigEndpoint(sess, candidateUrls[0], requiredEvents)
      // () => this._configureViaSessionUpdate(sess, candidateUrls, requiredEvents, getSessionInfoFn) // last resort, disabled
    ];
    const work = (async () => {
      try {
        for (const method of methods) {
          try {
            const result = await method();
            if (result.ensured) {
              this._webhookEnsuredFor.add(sess);
              return result;
            }
          } catch (error) {
            console.error('Webhook configuration method failed:', error.message);
          }
        }
        // Final verification: if webhook is already present, assume ensured
        try {
          const assumed = await this._verifyWebhookConfig(sess, candidateUrls, getSessionInfoFn)
            || await this._verifyWebhookViaEndpoint(sess, candidateUrls);
          if (assumed) {
            this._webhookEnsuredFor.add(sess);
            console.log(`Webhook appears already configured for '${sess}'; assuming ensured.`);
            return { ensured: true, session: sess, assumed: true };
          }
        } catch (_) {}

        throw new Error('Could not ensure WAHA events webhook configuration');
      } finally {
        this._ensureInFlight.delete(sess);
      }
    })();

    this._ensureInFlight.set(sess, work);
    return await work;
  }

  async _getAuthenticatedSessionStatus(sess, getSessionInfoFn) {
    try {
      const info = await getSessionInfoFn(sess);
      const status = info?.data?.status || 'UNKNOWN';
      const isAuthenticated = status === 'WORKING' || status === 'AUTHENTICATED';
      return { isAuthenticated, reason: isAuthenticated ? null : `session status ${status}` };
    } catch (_) {
      return { isAuthenticated: false, reason: 'no session info' };
    }
  }

  async _isWebhookCached(sess, candidateUrls, requiredEvents) {
    if (!this._webhookEnsuredFor.has(sess)) return false;
    
    try {
      const res = await httpClient.get(`${this.baseURL}/api/sessions/${sess}/webhooks`, { timeout: 7000 });
      const items = Array.isArray(res.data) ? res.data : (Array.isArray(res.data?.webhooks) ? res.data.webhooks : []);
      const candLower = candidateUrls.map(u => String(u).toLowerCase());
      const found = items.find(w => candLower.includes(String(w?.url || '').toLowerCase()));
      const hasAllEvents = Array.isArray(found?.events) && requiredEvents.every(e => found.events.includes(e));
      
      if (found && hasAllEvents) return true;
      
      this._webhookEnsuredFor.delete(sess);
      return false;
    } catch (_) {
      this._webhookEnsuredFor.delete(sess);
      return false;
    }
  }

  async _configureViaSessionUpdate(sess, candidateUrls, requiredEvents, getSessionInfoFn) {
    let currentConfig = {};
    try {
      const sessInfo = await getSessionInfoFn(sess);
      currentConfig = sessInfo?.data?.config || {};
    } catch (infoErr) {
      console.log('Could not fetch current session config (proceeding with minimal config):', infoErr.message);
    }

    const retriesCfg = { policy: 'constant', delaySeconds: 2, attempts: 3 };
    let webhooks = Array.isArray(currentConfig.webhooks) ? currentConfig.webhooks.slice() : [];
    const lowerExisting = webhooks.map(w => (w?.url || '').toLowerCase());
    
    for (const url of candidateUrls) {
      const idx = lowerExisting.indexOf(url.toLowerCase());
      if (idx >= 0) {
        const existing = webhooks[idx] || {};
        const mergedEvents = Array.from(new Set([...(Array.isArray(existing.events) ? existing.events : []), ...requiredEvents]));
        webhooks[idx] = { ...existing, url, events: mergedEvents, hmac: existing.hmac ?? null, retries: existing.retries ?? retriesCfg };
      } else {
        webhooks.push({ url, events: requiredEvents, hmac: null, retries: retriesCfg });
        lowerExisting.push(url.toLowerCase());
      }
    }

    const newConfig = { ...currentConfig, webhooks };
    newConfig.webhook = { url: candidateUrls[0], events: requiredEvents, hmac: null, retries: retriesCfg };
    
    const payload = { name: sess, config: newConfig };
    await httpClient.put(`${this.baseURL}/api/sessions/${sess}`, payload, { 
      timeout: 12000, 
      headers: { 'Content-Type': 'application/json' } 
    });
    
    console.log(`Configured WAHA webhook via session update for '${sess}' -> ${candidateUrls[0]}`);
    
    // Verify configuration
    const verified = await this._verifyWebhookConfig(sess, candidateUrls, getSessionInfoFn);
    return { ensured: verified, session: sess, configured: verified, method: 'PUT /api/sessions/{sess}' };
  }

  async _configureViaWebhooksEndpoint(sess, candidateUrls, requiredEvents) {
    for (const url of candidateUrls) {
      try {
        await httpClient.post(`${this.baseURL}/api/sessions/${sess}/webhooks`, {
          url, events: requiredEvents, hmac: null, 
          retries: { policy: 'constant', delaySeconds: 2, attempts: 3 }
        }, { timeout: 10000, headers: { 'Content-Type': 'application/json' } });
        
        console.log(`Configured WAHA webhook for session '${sess}' -> ${url}`);
      } catch (onePostErr) {
        try {
          const minimalEvents = ['message', 'session.status'];
          await httpClient.post(`${this.baseURL}/api/sessions/${sess}/webhooks`, {
            url, events: minimalEvents, hmac: null,
            retries: { policy: 'constant', delaySeconds: 2, attempts: 3 }
          }, { timeout: 10000, headers: { 'Content-Type': 'application/json' } });
          
          console.log(`Configured WAHA webhook (minimal events) for '${sess}' -> ${url}`);
        } catch (onePostErr2) {
          console.warn(`Failed to configure webhook URL via /webhooks: ${url} (${onePostErr2?.response?.status || onePostErr2.message})`);
        }
      }
    }
    
    const verified = await this._verifyWebhookViaEndpoint(sess, candidateUrls);
    return { ensured: verified, session: sess, configured: verified, method: 'POST /webhooks' };
  }

  async _configureViaConfigEndpoint(sess, webhookUrl, requiredEvents) {
    const payload = {
      webhooks: [{ 
        url: webhookUrl, 
        events: requiredEvents, 
        hmac: null, 
        retries: { policy: 'constant', delaySeconds: 2, attempts: 3 } 
      }]
    };
    
    await httpClient.put(`${this.baseURL}/api/sessions/${sess}/config`, payload, { 
      timeout: 10000, 
      headers: { 'Content-Type': 'application/json' } 
    });
    
    console.log(`Configured WAHA webhook via PUT /config for '${sess}' -> ${webhookUrl}`);
    return { ensured: true, session: sess, configured: true, method: 'PUT /api/sessions/{sess}/config' };
  }

  async _verifyWebhookConfig(sess, candidateUrls, getSessionInfoFn) {
    try {
      const verifySess = await getSessionInfoFn(sess);
      const cfg = verifySess?.data?.config || {};
      const wh = Array.isArray(cfg.webhooks) ? cfg.webhooks : [];
      const candLower = candidateUrls.map(u => String(u).toLowerCase());
      const foundArray = wh.find(w => candLower.includes(String(w?.url || '').toLowerCase()));
      const single = cfg.webhook && candLower.includes(String(cfg.webhook.url || '').toLowerCase());
      
      console.log(`Session '${sess}' webhook config now has ${wh.length} entr(y/ies).`);
      if (Array.isArray(wh)) {
        console.log('Webhook URLs:', wh.map(w => w?.url).filter(Boolean));
      }
      
      return !!(foundArray || single);
    } catch (verErr) {
      console.warn('Verification via session GET failed:', verErr.message);
      return false;
    }
  }

  async _verifyWebhookViaEndpoint(sess, candidateUrls) {
    try {
      const verify = await httpClient.get(`${this.baseURL}/api/sessions/${sess}/webhooks`, { timeout: 7000 });
      const items = Array.isArray(verify.data) ? verify.data : (Array.isArray(verify.data?.webhooks) ? verify.data.webhooks : []);
      const candLower = candidateUrls.map(u => String(u).toLowerCase());
      const found = items.find(w => candLower.includes(String(w?.url || '').toLowerCase()));
      return !!found;
    } catch (vErr) {
      return false;
    }
  }

  // Cache management
  resetWebhookCaches() {
    const sess = this.sessionName || 'default';
    this._webhookEnsuredFor.delete(sess);
    this._webhookMonitorStartedFor.delete(sess);
  }

  safeStartWebhookMonitor(getSessionInfoFn, sleepFn) {
    try {
      this.startWebhookAuthMonitor(this.sessionName, getSessionInfoFn, sleepFn);
    } catch (e) {
      console.log('Failed to start webhook auth monitor:', e.message);
    }
  }

  safeEnsureWebhook(getSessionInfoFn, sleepFn, waitForStartCompletionFn) {
    try {
      this.ensureWebhookConfigured(this.sessionName, getSessionInfoFn, sleepFn, waitForStartCompletionFn);
    } catch (e) {
      console.log('Ensure webhook failed (will retry on auth):', e.message);
    }
  }
}

module.exports = WAHAWebhookManager;
