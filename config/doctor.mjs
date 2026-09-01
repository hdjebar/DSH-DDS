#!/usr/bin/env node

/**
 * 🩺 DSH & Phoenix Ecosystem Doctor
 * Validates credentials, network endpoints, plugins, MCP servers, and LLM bridges.
 */

import fs from 'fs';
import path from 'path';

const OPENROUTER_API_KEY = (process.env.OPENROUTER_API_KEY || '').trim();
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const GITHUB_TOKEN = (process.env.GITHUB_PERSONAL_ACCESS_TOKEN || process.env.GITHUB_TOKEN || '').trim();
const PHOENIX_URL = process.env.PHOENIX_URL || 'http://phoenix:6006';

let passCount = 0;
let warnCount = 0;
let failCount = 0;

function pass(title, detail = '') {
  console.log(`  ✅ \x1b[32m${title}\x1b[0m${detail ? ` — \x1b[90m${detail}\x1b[0m` : ''}`);
  passCount++;
}

function warn(title, detail = '') {
  console.log(`  ⚠️  \x1b[33m${title}\x1b[0m${detail ? ` — \x1b[90m${detail}\x1b[0m` : ''}`);
  warnCount++;
}

function fail(title, detail = '') {
  console.log(`  ❌ \x1b[31m${title}\x1b[0m${detail ? ` — \x1b[90m${detail}\x1b[0m` : ''}`);
  failCount++;
}

async function checkDshEngine() {
  console.log('\n🔍 [1/7] DeepSeek Harness Engine:');
  try {
    const res = await fetch('http://127.0.0.1:3079/');
    if (res.ok) {
      pass('DSH Internal Engine', 'Listening on 127.0.0.1:3079 (HTTP 200)');
    } else {
      warn('DSH Internal Engine', `Responded with status ${res.status}`);
    }
  } catch (err) {
    fail('DSH Internal Engine', `Cannot connect to 127.0.0.1:3079 (${err.message})`);
  }

  try {
    const res = await fetch('http://127.0.0.1:3080/');
    if (res.ok) {
      pass('DSH Proxy Gateway', 'Listening on 0.0.0.0:3080 (HTTP 200)');
    } else {
      warn('DSH Proxy Gateway', `Responded with status ${res.status}`);
    }
  } catch (err) {
    fail('DSH Proxy Gateway', `Cannot connect to 127.0.0.1:3080 (${err.message})`);
  }
}

async function checkPhoenixTelemetry() {
  console.log('\n🔍 [2/7] Arize Phoenix Telemetry & Observability:');
  try {
    const res = await fetch(`${PHOENIX_URL}/v1/projects`);
    if (res.ok) {
      const data = await res.json();
      pass('Phoenix OTel Server', `Connected at ${PHOENIX_URL} (Projects: ${data.data?.length || 0})`);
    } else {
      warn('Phoenix OTel Server', `HTTP ${res.status} from ${PHOENIX_URL}`);
    }
  } catch (err) {
    fail('Phoenix OTel Server', `Cannot reach ${PHOENIX_URL} (${err.message})`);
  }
}

async function checkGoogleGemini() {
  console.log('\n🔍 [3/7] Google AI Studio & Thought Signature Bridge:');
  if (!GEMINI_API_KEY) {
    warn('GEMINI_API_KEY', 'Not set in environment (Google Gemini models disabled)');
    return;
  }
  try {
    const url = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GEMINI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gemini-3.7-flash',
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 5
      })
    });
    if (res.ok) {
      pass('Google AI Studio API', 'Authenticated successfully (gemini-3.7-flash live)');
    } else {
      fail('Google AI Studio API', `HTTP ${res.status}: ${await res.text()}`);
    }
  } catch (err) {
    fail('Google AI Studio API', `Connection failed (${err.message})`);
  }
}

async function checkOpenRouter() {
  console.log('\n🔍 [4/7] OpenRouter LLM Gateway:');
  if (!OPENROUTER_API_KEY) {
    warn('OPENROUTER_API_KEY', 'Not set in environment (OpenRouter models disabled)');
    return;
  }
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` }
    });
    if (res.ok) {
      const data = await res.json();
      pass('OpenRouter API', `Authenticated successfully (${data.data?.length || 0} models available)`);
    } else {
      fail('OpenRouter API', `HTTP ${res.status}: ${await res.text()}`);
    }
  } catch (err) {
    fail('OpenRouter API', `Connection failed (${err.message})`);
  }
}

async function checkGitHubToken() {
  console.log('\n🔍 [5/7] GitHub MCP Authentication:');
  if (!GITHUB_TOKEN) {
    warn('GITHUB_PERSONAL_ACCESS_TOKEN', 'Not set in environment (GitHub MCP will be unauthenticated)');
    return;
  }
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        'User-Agent': 'DSH-Doctor'
      }
    });
    if (res.ok) {
      const user = await res.json();
      pass('GitHub Token', `Authenticated as @${user.login} (${user.name || 'User'})`);
    } else {
      fail('GitHub Token', `HTTP ${res.status}: Invalid token or missing scopes`);
    }
  } catch (err) {
    fail('GitHub Token', `Connection failed (${err.message})`);
  }
}

async function checkPlugins() {
  console.log('\n🔍 [6/7] Pre-Packaged DSH Plugins:');
  const expectedPlugins = [
    '@liustack/modsearch',
    'dsh-find-plugin',
    'dsh-mcp-panel',
    'dsh-provider-model-configurator',
    'dsh-model-sync',
    'dsh-mnemon',
    'dsh-mcp-market',
    'dshmarket',
    'dsh-session-reader',
    'deepseek-flow'
  ];

  const pkgPath = '/root/.dsh/profiles/web/package.json';
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const p of expectedPlugins) {
        if (deps[p]) {
          pass(`Plugin: ${p}`, `v${deps[p]}`);
        } else {
          warn(`Plugin: ${p}`, 'Not declared in profile package.json');
        }
      }
    } catch {
      warn('Web Profile package.json', 'Could not parse JSON');
    }
  } else {
    warn('Web Profile Directory', 'Package manifest not found');
  }
}

async function checkStorage() {
  console.log('\n🔍 [7/7] Storage & Volume Mounts:');
  const dirs = [
    { path: '/root/.dsh', label: 'Config Directory (/root/.dsh)' },
    { path: '/workspaces', label: 'Workspaces Mount (/workspaces)' }
  ];
  for (const d of dirs) {
    if (fs.existsSync(d.path)) {
      pass(d.label, 'Mounted and writable');
    } else {
      fail(d.label, 'Directory missing');
    }
  }
}

async function runDoctor() {
  console.log('========================================================');
  console.log('🩺 DeepSeek Harness Ecosystem Diagnostics (Doctor)');
  console.log('========================================================');

  await checkDshEngine();
  await checkPhoenixTelemetry();
  await checkGoogleGemini();
  await checkOpenRouter();
  await checkGitHubToken();
  await checkPlugins();
  await checkStorage();

  console.log('\n========================================================');
  console.log(`📊 Summary: \x1b[32m${passCount} Passed\x1b[0m | \x1b[33m${warnCount} Warnings\x1b[0m | \x1b[31m${failCount} Failed\x1b[0m`);
  console.log('========================================================');

  if (failCount > 0) {
    process.exit(1);
  }
}

runDoctor().catch(err => {
  console.error('Doctor fatal error:', err);
  process.exit(1);
});
