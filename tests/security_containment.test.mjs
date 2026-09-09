import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  enforceRbacPolicy,
  logGrcAuditEvent,
  verifyGrcAuditChain
} from '../config/rbac-policy.mjs';
import { registerRbacInterceptor } from '../packages/dsh-dds-core/rbac-interceptor.js';
import { registerBashWorkdirShim } from '../packages/dsh-dds-core/index.js';

const admin = Object.freeze({ id: 'security-test-admin', roles: ['admin'] });

function restoreEnv(name, previous) {
  if (previous === undefined) delete process.env[name];
  else process.env[name] = previous;
}

test('compose profiles keep unconfined shell off and expose an external audit integrity key', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const base = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
  const sandbox = fs.readFileSync(path.join(root, 'docker-compose.sandbox.yml'), 'utf8');
  assert.match(base, /DSH_ALLOW_UNCONFINED_SHELL=\$\{DSH_ALLOW_UNCONFINED_SHELL:-0\}/);
  assert.match(base, /DSH_AUDIT_INTEGRITY_KEY=\$\{DSH_AUDIT_INTEGRITY_KEY:-\}/);
  assert.match(sandbox, /DSH_ALLOW_UNCONFINED_SHELL=0/);
});

test('shell policy defaults closed and sandbox ignores the trusted-operator escape hatch', () => {
  const previousEscape = process.env.DSH_ALLOW_UNCONFINED_SHELL;
  const previousSandbox = process.env.DSH_SANDBOX;
  const persona = {
    name: 'security-test',
    rbac: {
      role: 'admin',
      permissions: { filesystem: { read: ['/workspaces'], write: ['/workspaces/cases'], deny: [] } }
    }
  };
  const step = {
    name: 'bash',
    action: 'run_shell',
    target: '/workspaces/cases',
    workdir: '/workspaces/cases',
    command: 'pwd'
  };

  try {
    delete process.env.DSH_ALLOW_UNCONFINED_SHELL;
    delete process.env.DSH_SANDBOX;
    const denied = enforceRbacPolicy(persona, step);
    assert.equal(denied.allowed, false);
    assert.equal(denied.code, 'RBAC_SHELL_ISOLATION_REQUIRED');

    process.env.DSH_ALLOW_UNCONFINED_SHELL = '1';
    assert.equal(enforceRbacPolicy(persona, step).allowed, true);

    process.env.DSH_SANDBOX = '1';
    const sandboxDenied = enforceRbacPolicy(persona, step);
    assert.equal(sandboxDenied.allowed, false);
    assert.equal(sandboxDenied.code, 'RBAC_SHELL_ISOLATION_REQUIRED');
  } finally {
    restoreEnv('DSH_ALLOW_UNCONFINED_SHELL', previousEscape);
    restoreEnv('DSH_SANDBOX', previousSandbox);
  }
});

test('inline PEP denies environment, audit, and cross-tenant shell attacks by default', async () => {
  const previousEscape = process.env.DSH_ALLOW_UNCONFINED_SHELL;
  const previousSandbox = process.env.DSH_SANDBOX;
  let beforeHook;
  registerRbacInterceptor({
    before(event, fn) {
      if (event === 'tool-execute') beforeHook = fn;
    }
  }, { enableToolRbac: true });

  try {
    delete process.env.DSH_ALLOW_UNCONFINED_SHELL;
    delete process.env.DSH_SANDBOX;
    for (const command of [
      'env',
      'printf forged >> /var/lib/dsh/audit/audit_grc.jsonl',
      'cat /var/lib/dsh/users/bob/storages/vault.enc.json'
    ]) {
      await assert.rejects(
        () => beforeHook({
          user: admin,
          toolName: 'bash',
          command,
          workdir: '/workspaces/cases'
        }),
        /Unconfined shell execution is disabled/
      );
    }
  } finally {
    restoreEnv('DSH_ALLOW_UNCONFINED_SHELL', previousEscape);
    restoreEnv('DSH_SANDBOX', previousSandbox);
  }
});

test('denied tool requests cannot create their requested workdir', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-preauth-side-effect-'));
  const requestedWorkdir = path.join(tempRoot, 'must-not-exist');
  let beforeHook;
  registerRbacInterceptor({
    before(event, fn) {
      if (event === 'tool-execute') beforeHook = fn;
    }
  }, { enableToolRbac: true });

  try {
    await assert.rejects(
      () => beforeHook({
        user: admin,
        toolName: 'unknown-unmapped-tool',
        workdir: requestedWorkdir
      }),
      /unmapped or unauthorized tool/
    );
    assert.equal(fs.existsSync(requestedWorkdir), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('legacy bash executor escape hatch strips secrets from child environments', () => {
  class MockExecutor {
    spawnSpec(spec) {
      return spec;
    }
  }
  registerBashWorkdirShim(MockExecutor);

  const result = new MockExecutor().spawnSpec({
    workdir: os.tmpdir(),
    env: {
      PATH: '/usr/bin:/bin',
      HOME: '/home/dsh',
      LANG: 'C.UTF-8',
      OPENROUTER_API_KEY: 'secret-provider-key',
      DSH_VAULT_MASTER_KEY: 'secret-vault-key',
      PHOENIX_SECRET: 'secret-phoenix-key'
    }
  });

  assert.deepEqual(result.env, {
    PATH: '/usr/bin:/bin',
    HOME: '/home/dsh',
    LANG: 'C.UTF-8'
  });
});

test('audit log uses a verifiable HMAC chain and detects offline modification', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-audit-integrity-'));
  const auditFile = path.join(tempRoot, 'audit', 'audit_grc.jsonl');
  const previousFile = process.env.DSH_AUDIT_LOG_FILE;
  const previousSessions = process.env.DSH_SESSIONS_DIR;
  const previousKey = process.env.DSH_AUDIT_INTEGRITY_KEY;

  process.env.DSH_AUDIT_LOG_FILE = auditFile;
  process.env.DSH_SESSIONS_DIR = path.join(tempRoot, 'sessions');
  process.env.DSH_AUDIT_INTEGRITY_KEY = 'test-only-audit-integrity-key-32-bytes';
  try {
    logGrcAuditEvent({ action: 'read_file', decision: 'GRANTED', reason: 'test' }, '1'.repeat(32));
    logGrcAuditEvent({ action: 'modify_file', decision: 'DENIED', reason: 'test' }, '2'.repeat(32));

    const records = fs.readFileSync(auditFile, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(records.map((entry) => entry.sequence), [1, 2]);
    assert.equal(records[0].integrity_algorithm, 'hmac-sha256');
    assert.equal(records[1].previous_hash, records[0].entry_hash);
    assert.deepEqual(verifyGrcAuditChain(auditFile), {
      valid: true,
      entries: 2,
      protectedEntries: 2
    });

    records[0].decision = 'DENIED';
    fs.writeFileSync(auditFile, records.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
    const verification = verifyGrcAuditChain(auditFile);
    assert.equal(verification.valid, false);
    assert.match(verification.reason, /entry hash mismatch/);
    assert.throws(
      () => logGrcAuditEvent({ action: 'read_file', decision: 'GRANTED', reason: 'after-tamper' }),
      /GRC_AUDIT_INTEGRITY_FAILED/,
      'a modified primary trail must fail closed instead of silently switching sinks'
    );
  } finally {
    restoreEnv('DSH_AUDIT_LOG_FILE', previousFile);
    restoreEnv('DSH_SESSIONS_DIR', previousSessions);
    restoreEnv('DSH_AUDIT_INTEGRITY_KEY', previousKey);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
