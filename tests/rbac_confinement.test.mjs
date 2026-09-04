import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { enforceRbacPolicy, logGrcAuditEvent } from '../config/persona.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const PERSONAS_DIR = path.join(ROOT, 'config', 'personas');

test('Zero Trust RBAC: all 7 domain personas declare explicit RBAC matrices', () => {
  const personas = [
    'data-analyst',
    'devops-sre',
    'mlops-engineer',
    'persona-creator',
    'sdmx-expert',
    'security-auditor',
    'stats-engineer'
  ];

  for (const name of personas) {
    const manifestPath = path.join(PERSONAS_DIR, name, 'persona.yaml');
    const content = fs.readFileSync(manifestPath, 'utf8');

    assert.match(content, /rbac:\s*\n/, `Persona '${name}' must declare rbac: block`);
    assert.match(content, /role:\s*["']?\w+["']?/, `Persona '${name}' must define a specific role`);
    assert.match(content, /deny:\s*\n/, `Persona '${name}' must declare strict deny rules`);
    assert.ok(content.includes('reset.sh'), `Persona '${name}' must deny execution of reset.sh`);
    assert.ok(content.includes('install_dsh.sh'), `Persona '${name}' must deny execution of install_dsh.sh`);
  }
});

test('Zero Trust RBAC Enforcement: blocks unauthorized filesystem access and escalations', () => {
  const dataAnalystMeta = {
    name: 'data-analyst',
    rbac: {
      role: 'data_analyst',
      permissions: {
        filesystem: {
          read: ['/workspaces'],
          write: ['/workspaces'],
          deny: ['/etc', '/root/.ssh', 'config/personas/*', 'reset.sh', 'install_dsh.sh']
        },
        mcp: {
          allowed: ['sqlite-db', 'fetch']
        }
      }
    }
  };

  // 1. Allowed step
  const allowedStep = {
    action: 'inspect_sqlite',
    scope: '/workspaces/data.db'
  };
  const allowRes = enforceRbacPolicy(dataAnalystMeta, allowedStep);
  assert.equal(allowRes.allowed, true);

  // 2. Denied filesystem target (reset.sh)
  const maliciousStep1 = {
    action: 'execute_script',
    target: 'reset.sh'
  };
  const denyRes1 = enforceRbacPolicy(dataAnalystMeta, maliciousStep1);
  assert.equal(denyRes1.allowed, false);
  assert.equal(denyRes1.code, 'RBAC_DENY_VIOLATION');

  // 3. Denied cross-persona skill tampering
  const maliciousStep2 = {
    action: 'read_skill',
    target: 'config/personas/security-auditor/SKILL.md'
  };
  const denyRes2 = enforceRbacPolicy(dataAnalystMeta, maliciousStep2);
  assert.equal(denyRes2.allowed, false);
  assert.equal(denyRes2.code, 'RBAC_DENY_VIOLATION');

  // 4. Denied unauthorized MCP
  const unauthorizedMcpStep = {
    action: 'mcp:docker-daemon',
    target: 'containers'
  };
  const denyMcpRes = enforceRbacPolicy(dataAnalystMeta, unauthorizedMcpStep);
  assert.equal(denyMcpRes.allowed, false);
  assert.equal(denyMcpRes.code, 'RBAC_MCP_UNAUTHORIZED');
});

test('GRC Audit Logging: records immutable decision trace', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-grc-test-'));
  const testAuditFile = path.join(tmpDir, 'audit.jsonl');
  const prevEnv = process.env.DSH_AUDIT_LOG_FILE;
  process.env.DSH_AUDIT_LOG_FILE = testAuditFile;
  try {
    const event = logGrcAuditEvent({
      persona: 'security-auditor',
      workflow: 'incident_triage',
      step_index: 1,
      step_name: 'Assess Threat',
      action: 'evaluate_incident',
      target: 'workspace',
      decision: 'GRANTED',
      role: 'security_auditor',
      reason: 'Policy validated'
    });

    assert.equal(event.event_type, 'GRC_AUTHORIZATION_DECISION');
    assert.equal(event.decision, 'GRANTED');
    assert.ok(event.timestamp, 'Audit event must have ISO timestamp');
    assert.ok(fs.existsSync(testAuditFile));
  } finally {
    if (prevEnv !== undefined) {
      process.env.DSH_AUDIT_LOG_FILE = prevEnv;
    } else {
      delete process.env.DSH_AUDIT_LOG_FILE;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Build-Time Immutability Invariant: entrypoint.sh contains zero dynamic runtime patching', () => {
  const entrypoint = fs.readFileSync(path.join(ROOT, 'docker', 'entrypoint.sh'), 'utf8');

  assert.ok(
    !entrypoint.includes('patch_dsh_bash_local'),
    'docker/entrypoint.sh must not contain runtime patch_dsh_bash_local'
  );
  assert.ok(
    !entrypoint.includes('patch-pi-ai'),
    'docker/entrypoint.sh must not contain runtime patch-pi-ai'
  );

  const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  assert.ok(
    dockerfile.includes('Build-Time Immutability: Patch dsh-bash-local'),
    'Dockerfile must apply dsh-bash-local patch at build time'
  );
  assert.ok(
    dockerfile.includes('pi-ai thought signature bridge applied successfully'),
    'Dockerfile must apply pi-ai patch at build time'
  );
});
