import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  assertPolicyContract,
  createDefaultDenyPolicy,
  resolveEffectivePolicy
} from '../config/policy-manifest.mjs';
import { createPersona, parsePersonaYaml } from '../config/persona.mjs';

const ROOT = process.cwd();

function manifest(policy = createDefaultDenyPolicy('test-persona')) {
  return { name: 'test-persona', rbac: policy };
}

function expectPolicyError(value, code) {
  assert.throws(
    () => assertPolicyContract(value),
    error => error?.code === code && error.message.startsWith(`${code}:`)
  );
}

test('policy contract accepts an explicit default-deny policy', () => {
  const meta = manifest();
  assert.equal(assertPolicyContract(meta), meta);
  assert.equal(resolveEffectivePolicy(meta), meta.rbac);
  assert.deepEqual(meta.rbac.permissions.filesystem.read, []);
  assert.deepEqual(meta.rbac.permissions.filesystem.write, []);
  assert.deepEqual(meta.rbac.permissions.mcp.allowed, []);
});

test('policy contract distinguishes missing required fields from invalid values', () => {
  expectPolicyError({}, 'RBAC_MANIFEST_MISSING');
  expectPolicyError({ rbac: { role: 'test' } }, 'RBAC_MANIFEST_MISSING');
  expectPolicyError({ rbac: { role: 'test', permissions: {} } }, 'RBAC_MANIFEST_MISSING');

  for (const invalid of [
    { rbac: 'admin' },
    { rbac: { role: '', permissions: { filesystem: { read: [], write: [], deny: [] } } } },
    { rbac: { role: 'test', permissions: { filesystem: { read: 'all', write: [], deny: [] } } } },
    { rbac: { role: 'test', permissions: { filesystem: { read: [''], write: [], deny: [] } } } },
    { rbac: { role: 'test', permissions: { filesystem: { read: [], write: [], deny: [], execute: [] } } } },
    { rbac: { role: 'test', permissions: { filesystem: { read: [], write: [], deny: [] }, mcp: { allowed: [], unknown: true } } } },
    { rbac: { role: 'test', permissions: { filesystem: { read: [], write: [], deny: [] }, tools: 'invalid' } } },
    { rbac: { role: 'test', permissions: { filesystem: { read: [], write: [], deny: [] }, tools: [''] } } },
    { rbac: { role: 'test', permissions: { filesystem: { read: [], write: [], deny: [] }, network: [] } } }
  ]) {
    expectPolicyError(invalid, 'RBAC_MANIFEST_INVALID');
  }
});

test('parsePersonaYaml fails closed for missing and malformed manifests', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-policy-'));
  try {
    assert.throws(
      () => parsePersonaYaml(path.join(tempDir, 'missing.yaml')),
      error => error?.code === 'RBAC_MANIFEST_MISSING'
    );
    const malformed = path.join(tempDir, 'persona.yaml');
    fs.writeFileSync(malformed, 'name: broken\nrbac: [\n', 'utf8');
    assert.throws(
      () => parsePersonaYaml(malformed),
      error => error?.code === 'RBAC_MANIFEST_INVALID'
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('every shipped persona and starter template carries a valid policy contract', () => {
  const roots = [
    path.join(ROOT, 'config', 'personas'),
    path.join(ROOT, 'config', 'templates', 'personas')
  ];
  for (const root of roots) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(root, entry.name, 'persona.yaml');
      if (!fs.existsSync(manifestPath)) continue;
      const parsed = parsePersonaYaml(manifestPath);
      assert.ok(parsed.rbac, `${manifestPath} must resolve an RBAC policy`);
    }
  }
});

test('persona creation rewrites the template policy identity and scoped path', () => {
  const name = `tmp-policy-${process.pid}-${Date.now()}`;
  const personaDir = path.join(ROOT, 'config', 'personas', name);
  const skillDir = path.join(ROOT, 'config', 'skills', name);
  try {
    createPersona(name, 'data-analyst');
    const parsed = parsePersonaYaml(path.join(personaDir, 'persona.yaml'));
    assert.equal(parsed.rbac.role, name.replace(/-/g, '_'));
    assert.ok(parsed.rbac.permissions.filesystem.read.includes(`/root/.dsh/personas/${name}`));
    assert.ok(!parsed.rbac.permissions.filesystem.read.includes('/root/.dsh/personas/data-analyst'));
  } finally {
    fs.rmSync(personaDir, { recursive: true, force: true });
    fs.rmSync(skillDir, { recursive: true, force: true });
  }
});

test('distilled personas emit a valid default-deny policy contract', () => {
  const name = `tmp-distilled-${process.pid}-${Date.now()}`;
  const personaDir = path.join(ROOT, 'config', 'personas', name);
  const skillDir = path.join(ROOT, 'config', 'skills', name);
  try {
    execFileSync(process.execPath, ['config/persona.mjs', 'distill', name], {
      cwd: ROOT,
      stdio: 'pipe'
    });
    const parsed = parsePersonaYaml(path.join(personaDir, 'persona.yaml'));
    assert.equal(parsed.rbac.role, name.replace(/-/g, '_'));
    assert.deepEqual(parsed.rbac.permissions.filesystem.read, []);
    assert.deepEqual(parsed.rbac.permissions.filesystem.write, []);
    assert.deepEqual(parsed.rbac.permissions.mcp.allowed, []);
  } finally {
    fs.rmSync(personaDir, { recursive: true, force: true });
    fs.rmSync(skillDir, { recursive: true, force: true });
  }
});
