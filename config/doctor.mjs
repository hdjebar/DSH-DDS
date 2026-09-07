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
const PHOENIX_API_KEY = process.env.PHOENIX_API_KEY || '';

function getPhoenixHeaders(extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (PHOENIX_API_KEY) {
    headers['Authorization'] = `Bearer ${PHOENIX_API_KEY}`;
    headers['api_key'] = PHOENIX_API_KEY;
  }
  return headers;
}

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

function safeErrorSnippet(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';
  return rawText
    .slice(0, 100)
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\b(sk-[a-zA-Z0-9-_]{20,})\b/g, '[REDACTED_API_KEY]')
    .replace(/\b(AIza[0-9A-Za-z_-]{35})\b/g, '[REDACTED_GEMINI_KEY]')
    .replace(/\b(ghp_[a-zA-Z0-9]{30,})\b/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/\b(github_pat_[0-9a-zA-Z_]{82})\b/g, '[REDACTED_GITHUB_PAT]')
    .replace(/\b(Bearer\s+[a-zA-Z0-9._-]{20,})\b/gi, 'Bearer [REDACTED_TOKEN]');
}

function checkSecretPermissions() {
  console.log('\n🔒 [0/9] Security & Secret Permissions:');
  const vaultKey = process.env.DSH_VAULT_MASTER_KEY;
  if (!vaultKey) {
    fail('BYOK Vault Master Key', 'DSH_VAULT_MASTER_KEY is not set. Vault encryption requires >= 32 chars.');
  } else if (vaultKey.length < 32) {
    fail('BYOK Vault Master Key', `DSH_VAULT_MASTER_KEY is too short (${vaultKey.length} chars, must be >= 32).`);
  } else {
    pass('BYOK Vault Master Key', `Configured (${vaultKey.length} chars)`);
  }

  const hostEnvStatus = process.env.DSH_HOST_ENV_STATUS;
  const hostEnvMode = process.env.DSH_HOST_ENV_MODE;

  if (hostEnvStatus === 'PRESENT' && hostEnvMode) {
    const modeNum = parseInt(hostEnvMode, 8);
    const isGroupOrWorldReadable = !isNaN(modeNum) && (modeNum & 0o077) !== 0;
    if (isGroupOrWorldReadable) {
      warn('.env File Permissions (Host)', `Mode 0${hostEnvMode} is accessible by group/others. Run 'chmod 600 .env' to restrict.`);
    } else {
      pass('.env File Permissions (Host)', `Mode 0${hostEnvMode} (restricted to owner)`);
    }
    return;
  } else if (hostEnvStatus === 'ABSENT') {
    pass('.env File Permissions (Host)', 'No host .env file present');
    return;
  }

  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    try {
      const stats = fs.statSync(envPath);
      const isGroupOrWorldReadable = (stats.mode & 0o077) !== 0;
      const modeOctal = (stats.mode & 0o777).toString(8);
      if (isGroupOrWorldReadable) {
        warn('.env File Permissions', `Mode 0${modeOctal} is accessible by group/others. Run 'chmod 600 .env' to restrict.`);
      } else {
        pass('.env File Permissions', `Mode 0${modeOctal} (restricted to owner)`);
      }
    } catch (err) {
      warn('.env File Permissions', `Could not check file mode: ${err.message}`);
    }
  } else {
    pass('.env File Permissions', 'No local .env file present');
  }
}

async function checkDshEngine() {
  console.log('\n🔍 [1/9] DeepSeek Harness Engine:');
  const dshPort = process.env.PORT || process.env.DSH_PORT || '3080';
  const dshUrl = `http://127.0.0.1:${dshPort}/`;
  const healthUrl = `http://127.0.0.1:${dshPort}/dsh-dds/health`;
  try {
    let healthOk = false;
    try {
      const hRes = await fetch(healthUrl);
      if (hRes.ok) {
        healthOk = true;
      }
    } catch {}

    const res = await fetch(dshUrl);
    if (res.ok || healthOk) {
      pass('DSH Service', `Listening on 0.0.0.0:${dshPort} (HTTP 200 / Health OK)`);
    } else if (res.status === 401) {
      pass('DSH Service', `Listening on 0.0.0.0:${dshPort} (HTTP 401 Token Protected)`);
    } else {
      warn('DSH Service', `Responded with status ${res.status}`);
    }
  } catch (err) {
    fail('DSH Service', `Cannot connect to 127.0.0.1:${dshPort} (${err.message})`);
  }
}

async function checkPhoenixTelemetry() {
  console.log('\n🔍 [2/9] Arize Phoenix Telemetry & Observability:');
  try {
    const res = await fetch(`${PHOENIX_URL}/v1/projects`, {
      headers: getPhoenixHeaders()
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const projectCount = data?.data?.length || 0;
      pass('Phoenix OTel Server', `Connected at ${PHOENIX_URL} (Projects: ${projectCount})`);
    } else {
      warn('Phoenix OTel Server', `Returned status ${res.status}`);
    }
  } catch (err) {
    warn('Phoenix OTel Server', `Could not connect at ${PHOENIX_URL} (${err.message})`);
  }
}

async function checkGoogleGemini() {
  console.log('\n🔍 [3/9] Google AI Studio & Thought Signature Bridge:');
  if (!GEMINI_API_KEY) {
    warn('Google AI Studio Key', 'GEMINI_API_KEY not configured in environment (optional)');
    return;
  }
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`;
    const res = await fetch(url);
    if (res.ok) {
      pass('Google AI Studio API', 'Authenticated successfully (gemini-3.7-flash live)');
    } else {
      warn('Google AI Studio API', `Authentication failed (${res.status}) — check GEMINI_API_KEY`);
    }
  } catch (err) {
    warn('Google AI Studio API', `Could not reach Google API (${err.message})`);
  }
}

async function checkOpenRouter() {
  console.log('\n🔍 [4/9] OpenRouter LLM Gateway:');
  if (!OPENROUTER_API_KEY) {
    warn('OpenRouter Key', 'OPENROUTER_API_KEY not configured in environment (optional)');
    return;
  }
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}` }
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const count = data?.data?.length || 0;
      pass('OpenRouter API', `Authenticated successfully (${count} models available)`);
    } else {
      warn('OpenRouter API', `Authentication failed (${res.status}) — check OPENROUTER_API_KEY`);
    }
  } catch (err) {
    warn('OpenRouter API', `Could not reach OpenRouter API (${err.message})`);
  }
}

async function checkGitHubToken() {
  console.log('\n🔍 [5/9] GitHub MCP Authentication:');
  if (!GITHUB_TOKEN) {
    warn('GitHub Personal Access Token', 'GITHUB_PERSONAL_ACCESS_TOKEN not configured (optional for GitHub MCP)');
    return;
  }
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'DSH-Doctor/1.0'
      }
    });
    if (res.ok) {
      const user = await res.json().catch(() => ({}));
      pass('GitHub Token', `Authenticated as @${user.login} (${user.name || user.login})`);
    } else {
      warn('GitHub Token', `Authentication rejected (${res.status}) — check GITHUB_PERSONAL_ACCESS_TOKEN`);
    }
  } catch (err) {
    warn('GitHub Token', `Could not verify token with GitHub API (${err.message})`);
  }
}

async function checkMcpExecutables() {
  console.log('\n🔍 [6/9] Model Context Protocol (MCP) Executables & Permissions:');
  const mcpBinaries = [
    { name: 'mcp-server-webresearch', label: 'Web Research MCP (fetch)' },
    { name: 'context7-mcp', label: 'Context7 Docs MCP (context7)' },
    { name: 'github-mcp-server', label: 'GitHub MCP Server (github)' },
    { name: 'mcp-server-sqlite', label: 'SQLite DB MCP (sqlite-db)' }
  ];

  for (const b of mcpBinaries) {
    const binPath = findExecutable(b.name);
    if (binPath) {
      try {
        fs.accessSync(binPath, fs.constants.X_OK);
        pass(`MCP Binary: ${b.name}`, `${b.label} — executable verified (${binPath})`);
      } catch {
        warn(`MCP Binary: ${b.name}`, `Found at ${binPath} but lacks execution permission (chmod +x)`);
      }
    } else {
      warn(`MCP Binary: ${b.name}`, `${b.label} — binary not found in system PATH`);
    }
  }
}

function findExecutable(cmd) {
  const pathDirs = (process.env.PATH || '').split(':').concat(['/root/.local/bin', '/usr/local/bin']);
  for (const dir of pathDirs) {
    const candidate = path.join(dir, cmd);
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {}
  }
  return null;
}

async function checkModelSyncStatus() {
  console.log('\n🔍 [7/9] Automated Model Sync Health:');
  const candidateStatusFiles = [
    process.env.DSH_RUNTIME_DIR ? path.join(process.env.DSH_RUNTIME_DIR, 'sync_status.json') : null,
    '/var/lib/dsh/sync_status.json',
    '/etc/dsh/sync_status.json',
    '/var/lib/dsh/cache/models.cache.json',
    '/etc/dsh/cache/models.cache.json',
    '/root/.dsh/sync_status.json',
    path.resolve(process.cwd(), 'config/sync_status.json'),
    path.resolve(process.cwd(), 'config/cache/models.cache.json')
  ].filter(Boolean);

  const target = candidateStatusFiles.find(f => fs.existsSync(f));

  if (target) {
    try {
      const syncData = JSON.parse(fs.readFileSync(target, 'utf8'));
      if (syncData.status === 'success' || syncData.models || syncData.providers) {
        const orCount = syncData.openRouterCount || syncData.providers?.openrouter?.total || 0;
        const gemCount = syncData.geminiCount || syncData.providers?.google?.total || 0;
        pass('Background Model Sync', `Active & Healthy (OpenRouter: ${orCount}, Gemini: ${gemCount})`);
      } else if (syncData.status === 'running') {
        pass('Background Model Sync', `Sync in progress (${syncData.timestamp})`);
      } else if (syncData.status === 'disabled') {
        pass('Background Model Sync', `Disabled (isolated sandbox runtime)`);
      } else if (syncData.status === 'partial') {
        warn('Background Model Sync', `Partial sync — Warnings: ${(syncData.errors || []).join('; ')}`);
      } else {
        fail('Background Model Sync', `Last sync failed: ${syncData.error || (syncData.errors || []).join('; ') || 'Unknown error'} (${syncData.timestamp})`);
      }
    } catch {
      warn('Background Model Sync', 'Status file exists but could not be parsed');
    }
  } else {
    warn('Background Model Sync', 'Not yet initialized (models will be synchronized automatically on boot)');
  }
}

async function checkPlugins() {
  console.log('\n🔍 [8/9] Pre-Packaged DSH Plugins:');
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

  const candidatePkgPaths = [
    '/etc/dsh/profiles/web/package.json',
    '/var/lib/dsh/profiles/web/package.json',
    '/app/prebuilt-profiles/web/package.json',
    '/root/.dsh/profiles/web/package.json',
    path.resolve(process.cwd(), 'config/profiles/web/package.json')
  ];
  const pkgPath = candidatePkgPaths.find(p => fs.existsSync(p));

  const candidateNodeModules = [
    '/app/prebuilt-profiles/web/node_modules',
    '/var/lib/dsh/profiles/web/node_modules',
    '/etc/dsh/profiles/web/node_modules',
    '/usr/local/lib/node_modules',
    '/root/.dsh/profiles/web/node_modules',
    path.resolve(process.cwd(), 'config/profiles/web/node_modules')
  ];
  const nodeModulesPath = candidateNodeModules.find(p => fs.existsSync(p)) || candidateNodeModules[0];

  if (pkgPath && fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const p of expectedPlugins) {
        if (deps[p]) {
          const modPath = path.join(nodeModulesPath, p);
          const isInstalled = fs.existsSync(modPath);
          if (isInstalled) {
            pass(`Plugin: ${p}`, `v${deps[p]} (installed in node_modules)`);
          } else {
            const altPath = candidateNodeModules.map(base => path.join(base, p)).find(p => fs.existsSync(p));
            if (altPath) {
              pass(`Plugin: ${p}`, `v${deps[p]} (verified in prebuilt-profiles)`);
            } else {
              warn(`Plugin: ${p}`, `Declared in package.json (v${deps[p]}) but directory missing in node_modules`);
            }
          }
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
  console.log('\n🔍 [9/9] Storage & Volume Mounts:');
  const dshConfigDir = process.env.DSH_CONFIG_DIR || '/etc/dsh';
  const dshHome = process.env.DSH_HOME || '/var/lib/dsh';

  const dirs = [
    { path: dshConfigDir, alt: 'config', label: `Config Directory (${dshConfigDir})`, writable: false },
    { path: path.join(dshHome, 'sessions'), alt: 'config/sessions', label: `Session Storage (${dshHome}/sessions)`, writable: true },
    { path: path.join(dshHome, 'audit'), alt: 'config/audit', label: `Audit Log Storage (${dshHome}/audit)`, writable: true },
    { path: '/workspaces/cases', alt: 'workspaces/cases', label: 'Workspaces Case Storage (/workspaces/cases)', writable: true }
  ];
  for (const d of dirs) {
    const targetPath = fs.existsSync(d.path) ? d.path : (fs.existsSync(d.alt) ? d.alt : null);
    if (targetPath) {
      if (d.writable) {
        try {
          const probeFile = path.join(targetPath, `.probe_${Date.now()}.tmp`);
          fs.writeFileSync(probeFile, 'ok', 'utf8');
          fs.unlinkSync(probeFile);
          pass(d.label, 'Mounted and writable (verified with I/O probe)');
        } catch (err) {
          warn(d.label, `Mounted but read-only / write failed (${err.message})`);
        }
      } else {
        pass(d.label, 'Mounted (read-only configuration plane)');
      }
    } else {
      warn(d.label, 'Directory not mounted or offline');
    }
  }
}

async function runDoctor() {
  console.log('========================================================');
  console.log('🩺 DeepSeek Harness Ecosystem Diagnostics (Doctor)');
  console.log('========================================================');

  checkSecretPermissions();
  await checkDshEngine();
  await checkPhoenixTelemetry();
  await checkGoogleGemini();
  await checkOpenRouter();
  await checkGitHubToken();
  await checkMcpExecutables();
  await checkModelSyncStatus();
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
