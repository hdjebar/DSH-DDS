/**
 * In-Process Event-Driven Model Catalog Service for @dsh-dds/core
 *
 * Replaces external background bash polling daemon (while true; sleep 2)
 * and standalone sync_models.mjs with a native Cordis service.
 */

import fs from 'fs';
import path from 'path';

export class ModelCatalogService {
  constructor(ctx, config = {}) {
    this.ctx = ctx;
    this.config = config;
    this.timer = null;
    this.lastSyncResult = null;
    this.syncInProgress = false;

    const intervalHours = config.modelSyncIntervalHours || 12;
    this.intervalMs = intervalHours * 60 * 60 * 1000;
  }

  start() {
    // 1. Initial sync on startup
    this.syncModels().catch(err => {
      console.warn(`[ModelCatalogService] Initial sync warning: ${err.message}`);
    });

    // 2. Set up in-process periodic timer
    this.timer = setInterval(() => {
      this.syncModels().catch(err => {
        console.warn(`[ModelCatalogService] Periodic sync error: ${err.message}`);
      });
    }, this.intervalMs);

    // Unref so timer does not prevent process exit on shutdown
    if (this.timer.unref) this.timer.unref();

    // 3. Register HTTP trigger route
    const registerRoute = (targetCtx) => {
      try {
        const webServer = targetCtx.webServer;
        if (!webServer || typeof webServer.register !== 'function') return;
        webServer.register({
          kind: 'exact',
          path: '/dsh-dds/api/models/sync',
          handler: async (req, res) => {
            if (req.method !== 'POST') {
              res.statusCode = 405;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST.' }));
              return;
            }

            try {
              const result = await this.syncModels();
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, result }));
            } catch (err) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: err.message }));
            }
          }
        });
      } catch {}
    };

    if (typeof this.ctx.inject === 'function') {
      this.ctx.inject(['webServer'], (webCtx) => registerRoute(webCtx));
    } else {
      registerRoute(this.ctx);
    }

    // 4. Listen to Cordis event bus
    this.ctx.on('models:sync', () => {
      this.syncModels().catch(() => {});
    });
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getCacheDir() {
    const dshHome = process.env.DSH_HOME || '/var/lib/dsh';
    const candidates = [
      process.env.DSH_CACHE_DIR,
      path.join(dshHome, 'cache'),
      path.join(dshHome, 'storages'),
      '/var/lib/dsh/cache',
      '/tmp'
    ].filter(Boolean);

    for (const dir of candidates) {
      try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.accessSync(dir, fs.constants.W_OK);
        return dir;
      } catch {}
    }
    return '/tmp';
  }

  async fetchOpenRouterModels() {
    const key = (process.env.OPENROUTER_API_KEY || '').trim();
    if (!key) return { models: [], configured: false };

    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${key}` }
      });
      if (!res.ok) return { models: [], error: `HTTP ${res.status}`, configured: true };
      const data = await res.json();
      return { models: data.data || [], configured: true };
    } catch (err) {
      return { models: [], error: err.message, configured: true };
    }
  }

  async fetchGoogleModels() {
    const key = (process.env.GEMINI_API_KEY || '').trim();
    if (!key) return { models: [], configured: false };

    try {
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
        headers: { 'x-goog-api-key': key }
      });
      if (!res.ok) return { models: [], error: `HTTP ${res.status}`, configured: true };
      const data = await res.json();
      const raw = data.models || [];
      const sunset = new Set(['models/gemini-2.5-flash', 'models/gemini-2.5-pro', 'models/gemini-2.5-flash-lite']);
      const models = raw
        .filter(m => m.supportedGenerationMethods?.includes('generateContent') && (m.name.includes('gemini') || m.name.includes('gemma')) && !sunset.has(m.name))
        .map(m => ({
          id: m.name.replace('models/', ''),
          name: m.displayName || m.name.replace('models/', ''),
          description: m.description || '',
          contextWindow: m.inputTokenLimit || 1048576,
          maxTokens: m.outputTokenLimit || 65536
        }));
      return { models, configured: true };
    } catch (err) {
      return { models: [], error: err.message, configured: true };
    }
  }

  async syncToPhoenix() {
    const phoenixUrl = process.env.PHOENIX_URL || 'http://phoenix:6006';
    const apiKey = process.env.PHOENIX_API_KEY || '';

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
      headers['api_key'] = apiKey;
    }

    const query = `
      mutation CreateProvider($input: CreateGenerativeModelCustomProviderMutationInput!) {
        createGenerativeModelCustomProvider(input: $input) {
          provider { id name provider }
        }
      }
    `;

    try {
      const res = await fetch(`${phoenixUrl}/graphql`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query,
          variables: {
            input: {
              name: 'OpenRouter',
              description: 'OpenRouter Unified LLM Gateway',
              provider: 'openrouter',
              clientConfig: {
                openai: {
                  openaiAuthenticationMethod: { apiKey: 'DSH_INDEPENDENT_GATEWAY' },
                  openaiClientKwargs: { baseUrl: 'https://openrouter.ai/api/v1' },
                  openaiApiType: 'CHAT_COMPLETIONS'
                }
              }
            }
          }
        })
      });

      if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async syncModels() {
    if (this.syncInProgress) return this.lastSyncResult;
    this.syncInProgress = true;

    try {
      const [orResult, googleResult] = await Promise.all([
        this.fetchOpenRouterModels(),
        this.fetchGoogleModels()
      ]);

      const phoenixResult = await this.syncToPhoenix().catch(() => ({ success: false }));

      const catalog = {
        total: orResult.models.length + googleResult.models.length,
        updatedAt: new Date().toISOString(),
        lastSync: new Date().toISOString(),
        providers: {
          openrouter: {
            configured: orResult.configured,
            count: orResult.models.length,
            error: orResult.error || null
          },
          google: {
            configured: googleResult.configured,
            count: googleResult.models.length,
            error: googleResult.error || null
          },
          phoenix: phoenixResult
        }
      };

      const cacheDir = this.getCacheDir();
      const cachePath = path.join(cacheDir, 'models.cache.json');
      fs.writeFileSync(cachePath, JSON.stringify(catalog, null, 2), 'utf8');

      this.lastSyncResult = catalog;
      return catalog;
    } finally {
      this.syncInProgress = false;
    }
  }
}
