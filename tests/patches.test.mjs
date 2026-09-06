import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const PATCHES_DIR = path.join(ROOT, 'config', 'profiles', 'web', 'patches');

test('Zero Patch Scripts Invariant: no legacy monkey-patch scripts exist in config/', () => {
  const configDir = path.join(ROOT, 'config');
  const entries = fs.readdirSync(configDir);
  const legacyPatches = entries.filter(name => (name.startsWith('patch-') || name.startsWith('patch_')) && name.endsWith('.mjs'));
  assert.deepEqual(
    legacyPatches,
    [],
    `config/ must contain zero legacy monkey-patch scripts, but found: ${legacyPatches.join(', ')}`
  );
});

test('Zero Disk Mutation Invariant: package.json has zero patchedDependencies and pnpm-workspace.yaml sets minimumReleaseAge: 0', () => {
  const pkgPath = path.join(ROOT, 'config', 'profiles', 'web', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  assert.equal(pkg.pnpm?.patchedDependencies, undefined, 'package.json must not have pnpm.patchedDependencies');

  const wsPath = path.join(ROOT, 'config', 'profiles', 'web', 'pnpm-workspace.yaml');
  const ws = fs.readFileSync(wsPath, 'utf8');
  assert.ok(ws.includes('minimumReleaseAge: 0'), 'pnpm-workspace.yaml must specify minimumReleaseAge: 0');
});

test('Zero Disk Patch Files Invariant: no patch directory or patch files exist in profiles', () => {
  assert.ok(!fs.existsSync(PATCHES_DIR), 'config/profiles/web/patches must not exist');
});


test('Core Plugin Migration: core gateway and localization replace legacy monkey-patch scripts', async () => {
  const corePlugin = await import('../packages/dsh-dds-core/index.js');
  assert.equal(corePlugin.name, '@dsh-dds/core');
  assert.ok(Array.isArray(corePlugin.inject));

  const gatewayMod = await import('../packages/dsh-dds-core/gateway.js');
  assert.equal(typeof gatewayMod.isTrustedGatewayIp, 'function');
  assert.equal(typeof gatewayMod.isSameOriginOrLoopback, 'function');
  assert.equal(typeof gatewayMod.registerGatewayMiddleware, 'function');

  const locMod = await import('../packages/dsh-dds-core/localization.js');
  assert.equal(typeof locMod.registerLocalizationTap, 'function');
});
