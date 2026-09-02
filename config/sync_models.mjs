#!/usr/bin/env node

/**
 * Dynamic Multi-Provider Model Synchronizer
 * Automatically runs on container boot to fetch live model catalogs
 * from OpenRouter & Google AI Studio and synchronize into DeepSeek Harness & Arize Phoenix.
 */

import fs from 'fs';
import path from 'path';

const OPENROUTER_API_KEY = (process.env.OPENROUTER_API_KEY || '').trim();
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const PHOENIX_URL = process.env.PHOENIX_URL || 'http://phoenix:6006';
const PHOENIX_API_KEY = process.env.PHOENIX_API_KEY || '';

function getPhoenixHeaders(extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (PHOENIX_API_KEY) {
    headers['Authorization'] = `Bearer ${PHOENIX_API_KEY}`;
    headers['api_key'] = PHOENIX_API_KEY;
  }
  return headers;
}

async function waitForPhoenix(maxRetries = 15) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`${PHOENIX_URL}/v1/projects`, {
        headers: getPhoenixHeaders()
      });
      if (res.ok) {
        console.log('✅ Arize Phoenix is ready.');
        return true;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log('⚠️ Arize Phoenix not yet responding, proceeding with best-effort sync.');
  return false;
}

async function fetchOpenRouterModels() {
  if (!OPENROUTER_API_KEY) {
    console.log('⚠️ OPENROUTER_API_KEY not set, skipping OpenRouter dynamic fetch.');
    return { models: [], error: null, configured: false };
  }
  try {
    console.log('🔄 Fetching live model catalog from OpenRouter...');
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` }
    });
    if (!res.ok) {
      const errText = `HTTP ${res.status}: ${res.statusText}`;
      console.error(`❌ OpenRouter API error: ${errText}`);
      return { models: [], error: errText, configured: true };
    }
    const data = await res.json();
    const models = data.data || [];
    console.log(`✅ Successfully fetched ${models.length} live models from OpenRouter.`);
    return { models, error: null, configured: true };
  } catch (err) {
    console.error('❌ Failed to fetch OpenRouter models:', err.message);
    return { models: [], error: err.message, configured: true };
  }
}

async function fetchGoogleModels() {
  if (!GEMINI_API_KEY) {
    console.log('⚠️ GEMINI_API_KEY not set, skipping Google AI Studio dynamic fetch.');
    return { models: [], error: null, configured: false };
  }
  try {
    console.log('🔄 Fetching live model catalog from Google AI Studio...');
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      headers: { 'x-goog-api-key': GEMINI_API_KEY }
    });
    if (!res.ok) {
      const errText = `HTTP ${res.status}: ${res.statusText}`;
      console.error(`❌ Google AI Studio API error: ${errText}`);
      return { models: [], error: errText, configured: true };
    }
    const data = await res.json();
    const raw = data.models || [];
    const models = raw
      .filter(m => m.supportedGenerationMethods?.includes('generateContent') && m.name.includes('gemini'))
      .map(m => ({
        id: m.name.replace('models/', ''),
        name: m.displayName || m.name.replace('models/', ''),
        description: m.description || '',
        contextWindow: m.inputTokenLimit || 1048576,
        maxTokens: m.outputTokenLimit || 8192
      }));
    console.log(`✅ Successfully fetched ${models.length} active Gemini models from Google AI Studio.`);
    return { models, error: null, configured: true };
  } catch (err) {
    console.error('❌ Failed to fetch Google models:', err.message);
    return { models: [], error: err.message, configured: true };
  }
}

async function syncToPhoenix(openRouterModels) {
  console.log('🔄 Ensuring OpenRouter custom provider in Arize Phoenix...');
  const ensureProviderQuery = `
    mutation CreateProvider($input: CreateGenerativeModelCustomProviderMutationInput!) {
      createGenerativeModelCustomProvider(input: $input) {
        provider { id name provider }
      }
    }
  `;
  try {
    const res = await fetch(`${PHOENIX_URL}/graphql`, {
      method: 'POST',
      headers: getPhoenixHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        query: ensureProviderQuery,
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
    if (!res.ok) {
      const msg = `HTTP ${res.status}: ${res.statusText}`;
      console.warn(`⚠️ Phoenix GraphQL sync returned ${msg}`);
      return { success: false, error: msg };
    }
    const data = await res.json();
    if (data.errors && data.errors.length > 0) {
      const genuineErrors = data.errors.filter(e => !e.message?.toLowerCase().includes('already exists'));
      if (genuineErrors.length > 0) {
        const msg = genuineErrors.map(e => e.message).join(', ');
        console.warn(`⚠️ Phoenix GraphQL error: ${msg}`);
        return { success: false, error: msg };
      }
    }
    return { success: true, error: null };
  } catch (err) {
    console.warn(`⚠️ Phoenix GraphQL sync connection error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

async function persistModelCache(openRouterModels, googleModels) {
  const cacheFile = path.resolve(process.cwd(), 'config/models.cache.json');
  const containerCacheFile = '/root/.dsh/models.cache.json';
  const targetPath = fs.existsSync('/root/.dsh') ? containerCacheFile : cacheFile;

  const catalog = {
    updatedAt: new Date().toISOString(),
    providers: {
      openrouter: {
        total: openRouterModels.length,
        models: openRouterModels.map(m => ({ id: m.id, name: m.name, context_length: m.context_length, pricing: m.pricing }))
      },
      gemini: {
        total: googleModels.length,
        models: googleModels
      }
    }
  };

  try {
    fs.writeFileSync(targetPath, JSON.stringify(catalog, null, 2), 'utf8');
    console.log(`💾 Persisted live model catalog (${openRouterModels.length} OpenRouter, ${googleModels.length} Gemini) to ${targetPath}`);
  } catch (err) {
    console.warn('⚠️ Model cache persist warning:', err.message);
  }
}

function updateSyncStatus(status, data = {}) {
  const statusFile = path.resolve(process.cwd(), 'config/sync_status.json');
  const containerStatusFile = '/root/.dsh/sync_status.json';
  const targetPath = fs.existsSync('/root/.dsh') ? containerStatusFile : statusFile;
  const payload = {
    status,
    timestamp: new Date().toISOString(),
    ...data
  };
  try {
    fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2), 'utf8');
  } catch {}
}

async function main() {
  console.log('========================================================');
  console.log('🚀 Dynamic Boot-Time Model Synchronization');
  console.log('========================================================');
  updateSyncStatus('running');

  try {
    const isPhoenixReady = await waitForPhoenix();
    const errors = [];

    if (!isPhoenixReady) {
      errors.push(`Arize Phoenix: Unreachable at ${PHOENIX_URL}`);
    }

    const [openRouterRes, googleRes] = await Promise.all([
      fetchOpenRouterModels(),
      fetchGoogleModels()
    ]);

    const openRouterModels = openRouterRes.models || [];
    const googleModels = googleRes.models || [];

    if (openRouterModels.length > 0 && isPhoenixReady) {
      const phoenixSyncRes = await syncToPhoenix(openRouterModels);
      if (!phoenixSyncRes.success && phoenixSyncRes.error) {
        errors.push(`Phoenix GraphQL: ${phoenixSyncRes.error}`);
      }
    }

    await persistModelCache(openRouterModels, googleModels);

    // Auto-patch plugin translations to English
    try {
      const patchScript = path.resolve(process.cwd(), 'config/patch_translations.mjs');
      const containerPatchScript = '/root/.dsh/patch_translations.mjs';
      if (fs.existsSync(containerPatchScript)) {
        await import(containerPatchScript);
      } else if (fs.existsSync(patchScript)) {
        await import(patchScript);
      }
    } catch {}

    if (openRouterRes.error) errors.push(`OpenRouter: ${openRouterRes.error}`);
    if (googleRes.error) errors.push(`Gemini: ${googleRes.error}`);

    let syncOutcome = 'success';
    if (errors.length > 0) {
      syncOutcome = (openRouterModels.length > 0 || googleModels.length > 0) ? 'partial' : 'failed';
    }

    updateSyncStatus(syncOutcome, {
      openRouterCount: openRouterModels.length,
      geminiCount: googleModels.length,
      errors: errors.length > 0 ? errors : null
    });

    console.log('========================================================');
    console.log(`🎉 Sync Finished [${syncOutcome}]: ${openRouterModels.length} OpenRouter & ${googleModels.length} Google Gemini models active.`);
    if (errors.length > 0) {
      console.warn(`⚠️ Provider warnings: ${errors.join(', ')}`);
    }
    console.log('========================================================');
  } catch (err) {
    updateSyncStatus('failed', { error: err.message });
    console.error('❌ Model sync failed:', err.message);
  }
}

main().catch(err => {
  updateSyncStatus('failed', { error: err.message });
  console.error('Fatal error during dynamic model sync:', err);
});
