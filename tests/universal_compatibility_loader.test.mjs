import test from 'node:test';
import assert from 'node:assert/strict';
import child_process from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const LOADER_PATH = path.join(ROOT, 'packages', 'dsh-dds-core', 'loader.mjs');
const LOADER_HOOKS_PATH = path.join(ROOT, 'packages', 'dsh-dds-core', 'loader-hooks.mjs');

test('Universal Compatibility: loader and loader-hooks files exist', () => {
  assert.ok(fs.existsSync(LOADER_PATH), 'loader.mjs must exist');
  assert.ok(fs.existsSync(LOADER_HOOKS_PATH), 'loader-hooks.mjs must exist');
});

test('Universal Compatibility: loader hook intercepts dsh-settings export', async () => {
  const { load } = await import(LOADER_HOOKS_PATH);
  const mockContext = {};
  const mockNextLoad = async () => ({
    format: 'module',
    source: 'export { SettingsConflictError, SettingsProvider };'
  });

  const result = await load('file:///node_modules/@deepseek-ai/dsh-settings/lib/index.js', mockContext, mockNextLoad);
  assert.ok(result.source.includes('settingsNamespace'), 'loader hook must synthesize settingsNamespace');
});

test('Universal Compatibility: loader hook removes bogus 400 (no body) from pi-ai overflow patterns', async () => {
  const { load } = await import(LOADER_HOOKS_PATH);
  const mockContext = {};
  const mockNextLoad = async () => ({
    format: 'module',
    source: `const OVERFLOW_PATTERNS = [
      /prompt is too long/i,
      /^4(?:00|13)\\s*(?:status code)?\\s*\\(no body\\)/i,
      /token limit exceeded/i
    ];`
  });

  const result = await load('file:///node_modules/@earendil-works/pi-ai/dist/utils/overflow.js', mockContext, mockNextLoad);
  assert.ok(!result.source.includes('/^4(?:00|13)'), 'loader hook must remove bogus 400 (no body) overflow pattern');
});

test('Universal Compatibility: loader hook injects thought signature bridge for pi-ai', async () => {
  const { load } = await import(LOADER_HOOKS_PATH);
  const mockContext = {};
  const mockNextLoad = async () => ({
    format: 'module',
    source: `const name = toolCall.function?.name ?? toolCall.custom?.name;
return {
                        id: tc.id,
                        type: "function",
                    };`
  });

  const result = await load('file:///node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js', mockContext, mockNextLoad);
  assert.ok(result.source.includes('googleExtraContentCache'), 'loader hook must inject thought signature cache');
  assert.ok(result.source.includes('tc.extra_content || googleExtraContentCache.get(tc.id)'), 'loader hook must echo thought signature');
});

test('Universal Compatibility: loader hook protects agent.session.events in dsh-mnemon', async () => {
  const { load } = await import(LOADER_HOOKS_PATH);
  const mockContext = {};
  const mockNextLoad = async () => ({
    format: 'module',
    source: 'for (const event of agent.session.events) { console.log(event); }'
  });

  const result = await load('file:///node_modules/dsh-mnemon/lib/index.js', mockContext, mockNextLoad);
  assert.ok(result.source.includes('agent?.session?.events ?? agent?.session?.snapshotEvents?.() ?? []'));
});

test('Universal Compatibility: loader subprocess wrapper auto-creates nonexistent cwd', () => {
  const tmpDir = path.join(os.tmpdir(), `dsh-test-cwd-${Date.now()}`);
  const nonexistentSubdir = path.join(tmpDir, 'auto-created-dir');

  // Verify it does not exist
  assert.equal(fs.existsSync(nonexistentSubdir), false);

  // Run node with --import loader.mjs executing a command in nonexistentSubdir
  const nodeBin = process.execPath;
  const res = child_process.spawnSync(
    nodeBin,
    ['--import', LOADER_PATH, '-e', `
      const cp = require("node:child_process");
      const out = cp.spawnSync("pwd", [], { cwd: ${JSON.stringify(nonexistentSubdir)}, encoding: "utf8" });
      process.exit(out.status === 0 ? 0 : 1);
    `],
    { encoding: 'utf8' }
  );

  assert.equal(res.status, 0, `Command should succeed without spawn ENOENT: ${res.stderr}`);
  assert.ok(fs.existsSync(nonexistentSubdir), 'Target working directory must be auto-created by loader');

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Universal Compatibility: loader hook auto-aliases client bundle registrations', async () => {
  const { load } = await import(LOADER_HOOKS_PATH);
  const mockContext = {};
  const mockNextLoad = async () => ({
    format: 'module',
    source: `initialBundleSnapshot(pkgName, clientPath) {
      const baseline = this.captureArtifactBaseline(clientPath);
      const bundle = readFileSync(clientPath);
      const sourceMap = this.readSourceMapSnapshot(clientPath);
    }`
  });

  const result = await load('file:///node_modules/@deepseek-ai/dsh-client-modules/lib/index.js', mockContext, mockNextLoad);
  assert.ok(result.source.includes('window.__ModuleLoader__.load'), 'loader hook must inject auto-aliasing preamble logic');
});

