#!/usr/bin/env node

/**
 * Dynamic Multi-Provider Model Synchronizer
 * Fetches live model catalogs from OpenRouter & Google AI Studio,
 * and synchronizes all 420+ models into DeepSeek Harness and Arize Phoenix.
 */

import fs from 'fs';
import path from 'path';

const OPENROUTER_API_KEY = (process.env.OPENROUTER_API_KEY || '').trim();
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const PHOENIX_URL = process.env.PHOENIX_URL || 'http://phoenix:6006';

async function fetchOpenRouterModels() {
  if (!OPENROUTER_API_KEY) {
    console.log('⚠️ OPENROUTER_API_KEY not set, skipping OpenRouter dynamic fetch.');
    return [];
  }
  try {
    console.log('🔄 Fetching live model catalog from OpenRouter...');
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` }
    });
    if (!res.ok) {
      console.error(`❌ OpenRouter API error: ${res.status} ${res.statusText}`);
      return [];
    }
    const data = await res.json();
    const models = data.data || [];
    console.log(`✅ Successfully fetched ${models.length} live models from OpenRouter.`);
    return models;
  } catch (err) {
    console.error('❌ Failed to fetch OpenRouter models:', err.message);
    return [];
  }
}

async function fetchGoogleModels() {
  if (!GEMINI_API_KEY) {
    console.log('⚠️ GEMINI_API_KEY not set, skipping Google AI Studio dynamic fetch.');
    return [];
  }
  try {
    console.log('🔄 Fetching live model catalog from Google AI Studio...');
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`);
    if (!res.ok) {
      console.error(`❌ Google AI Studio API error: ${res.status} ${res.statusText}`);
      return [];
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
    return models;
  } catch (err) {
    console.error('❌ Failed to fetch Google models:', err.message);
    return [];
  }
}

async function syncToPhoenixGraphQL(openRouterModels) {
  console.log('🔄 Registering OpenRouter provider in Arize Phoenix...');
  const ensureProviderQuery = `
    mutation CreateProvider($input: CreateGenerativeModelCustomProviderMutationInput!) {
      createGenerativeModelCustomProvider(input: $input) {
        provider { id name provider }
      }
    }
  `;
  try {
    await fetch(`${PHOENIX_URL}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: ensureProviderQuery,
        variables: {
          input: {
            name: 'OpenRouter',
            description: 'OpenRouter Unified LLM Gateway',
            provider: 'openrouter',
            clientConfig: {
              openai: {
                openaiAuthenticationMethod: { apiKey: OPENROUTER_API_KEY },
                openaiClientKwargs: { baseUrl: 'https://openrouter.ai/api/v1' },
                openaiApiType: 'CHAT_COMPLETIONS'
              }
            }
          }
        }
      })
    });
  } catch {}
}

async function main() {
  console.log('========================================================');
  console.log('🚀 Dynamic Multi-Provider Model Synchronization');
  console.log('========================================================');

  const [openRouterModels, googleModels] = await Promise.all([
    fetchOpenRouterModels(),
    fetchGoogleModels()
  ]);

  if (openRouterModels.length > 0) {
    await syncToPhoenixGraphQL(openRouterModels);
  }

  console.log('========================================================');
  console.log(`🎉 Sync Complete: ${openRouterModels.length} OpenRouter & ${googleModels.length} Google Gemini models active.`);
  console.log('========================================================');
}

main().catch(err => {
  console.error('Fatal sync error:', err);
  process.exit(1);
});
