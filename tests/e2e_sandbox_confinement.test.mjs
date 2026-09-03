import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { enforceRbacPolicy, logGrcAuditEvent, getGrcAuditLogPath } from '../config/persona.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

test('E2E Sandbox Confinement: deterministic adversarial injection dropping', () => {
  const securityAuditorMeta = {
    name: 'security-auditor',
    rbac: {
      role: 'security_auditor',
      permissions: {
        filesystem: {
          read: ['/workspaces', '/root/.dsh/personas/security-auditor'],
          write: ['/workspaces/cases', '/root/.dsh/sessions'],
          deny: ['/etc', '/root/.ssh', 'config/personas/*', 'reset.sh', 'install_dsh.sh']
        },
        mcp: {
          allowed: ['github', 'fetch']
        }
      }
    }
  };

  // Test vector 1: Authorized benign workflow step
  const benignStep = {
    name: 'Assess Workspace Threat Matrix',
    action: 'evaluate_incident',
    scope: '/workspaces/cases/report.md'
  };
  const benignRes = enforceRbacPolicy(securityAuditorMeta, benignStep);
  assert.equal(benignRes.allowed, true);
  assert.equal(benignRes.role, 'security_auditor');

  // Test vector 2: Adversarial injection targeting host reset script
  const attackVectorReset = {
    name: 'Malicious Wipe',
    action: 'execute_command',
    target: 'reset.sh'
  };
  const attackRes1 = enforceRbacPolicy(securityAuditorMeta, attackVectorReset);
  assert.equal(attackRes1.allowed, false);
  assert.equal(attackRes1.code, 'RBAC_DENY_VIOLATION');
  assert.ok(attackRes1.violation.includes('reset.sh'));

  // Test vector 3: Adversarial injection targeting host installer script
  const attackVectorInstall = {
    name: 'Malicious Re-install',
    action: 'spawn_subprocess',
    target: 'install_dsh.sh'
  };
  const attackRes2 = enforceRbacPolicy(securityAuditorMeta, attackVectorInstall);
  assert.equal(attackRes2.allowed, false);
  assert.equal(attackRes2.code, 'RBAC_DENY_VIOLATION');
  assert.ok(attackRes2.violation.includes('install_dsh.sh'));

  // Test vector 4: Path traversal to /etc/shadow
  const attackVectorShadow = {
    name: 'Exfiltrate Credentials',
    action: 'read_file',
    target: '/etc/shadow'
  };
  const attackRes3 = enforceRbacPolicy(securityAuditorMeta, attackVectorShadow);
  assert.equal(attackRes3.allowed, false);
  assert.equal(attackRes3.code, 'RBAC_DENY_VIOLATION');
  assert.ok(attackRes3.violation.includes('/etc'));

  // Test vector 5: Unauthorized MCP server
  const attackVectorMcp = {
    name: 'Unauthorized Docker Socket Access',
    action: 'mcp:docker-socket',
    target: '/var/run/docker.sock'
  };
  const attackRes4 = enforceRbacPolicy(securityAuditorMeta, attackVectorMcp);
  assert.equal(attackRes4.allowed, false);
  assert.equal(attackRes4.code, 'RBAC_MCP_UNAUTHORIZED');
});

test('E2E GRC Non-Repudiation: audit trail isolation and file integrity', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-e2e-audit-'));
  const testAuditFile = path.join(tmpDir, 'isolated_audit.jsonl');

  const prevEnv = process.env.DSH_AUDIT_LOG_FILE;
  process.env.DSH_AUDIT_LOG_FILE = testAuditFile;

  try {
    // 1. Record an authorized decision
    logGrcAuditEvent({
      persona: 'data-analyst',
      workflow: 'analyze_pipeline',
      step_index: 1,
      step_name: 'Query SQLite Datasets',
      action: 'inspect_sqlite',
      target: '/workspaces/data.db',
      decision: 'GRANTED',
      role: 'data_analyst',
      reason: 'Policy validated'
    });

    // 2. Record an intercepted security violation
    logGrcAuditEvent({
      persona: 'data-analyst',
      workflow: 'analyze_pipeline',
      step_index: 2,
      step_name: 'Attempt Host Script Escalation',
      action: 'execute_command',
      target: 'reset.sh',
      decision: 'DENIED',
      role: 'data_analyst',
      reason: 'Target reset.sh explicitly denied by RBAC policy rule'
    });

    assert.ok(fs.existsSync(testAuditFile), 'Audit ledger must be created at designated path');

    const lines = fs.readFileSync(testAuditFile, 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);

    const record1 = JSON.parse(lines[0]);
    assert.equal(record1.event_type, 'GRC_AUTHORIZATION_DECISION');
    assert.equal(record1.decision, 'GRANTED');
    assert.equal(record1.persona, 'data-analyst');
    assert.ok(record1.timestamp);

    const record2 = JSON.parse(lines[1]);
    assert.equal(record2.event_type, 'GRC_AUTHORIZATION_DECISION');
    assert.equal(record2.decision, 'DENIED');
    assert.equal(record2.target, 'reset.sh');
    assert.ok(record2.reason.includes('denied'));
  } finally {
    process.env.DSH_AUDIT_LOG_FILE = prevEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('E2E Sandbox Topology: compose sandbox invariants guarantee kernel confinement', () => {
  const sandboxCompose = fs.readFileSync(path.join(ROOT, 'docker-compose.sandbox.yml'), 'utf8');

  assert.ok(sandboxCompose.includes('read_only: true'), 'Sandbox must enforce read-only root filesystem');
  assert.ok(sandboxCompose.includes('cap_drop:'), 'Sandbox must drop Linux capabilities');
  assert.ok(sandboxCompose.includes('ALL'), 'Sandbox must drop ALL capabilities');
  assert.ok(sandboxCompose.includes('no-new-privileges:true'), 'Sandbox must block privilege escalation');
  assert.ok(sandboxCompose.includes('internal: true'), 'Sandbox network must be zero-egress internal');
});
