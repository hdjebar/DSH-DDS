import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DeclarativeWorkflowEngine } from '../config/declarative-orchestrator.mjs';

function createHarness(stepCount = 1) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-approval-v2-'));
  const sessionsDir = path.join(root, 'sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });

  const steps = Array.from({ length: stepCount }, (_, index) => ({
    name: `Gate ${index + 1}`,
    action: 'contain_threat',
    target: path.join(root, `gate-${index + 1}.json`),
    approval_required: true
  }));
  const meta = {
    name: 'approval-v2-test',
    rbac: {
      role: 'security_auditor',
      permissions: { filesystem: { read: [root], write: [root], deny: [] } }
    },
    workflows: { guarded: { steps } }
  };

  return { root, sessionsDir, engine: new DeclarativeWorkflowEngine(meta) };
}

function checkpointPath(sessionsDir, instanceId) {
  return path.join(sessionsDir, 'checkpoints', `${instanceId}.json`);
}

function readCheckpoint(sessionsDir, instanceId) {
  return JSON.parse(fs.readFileSync(checkpointPath(sessionsDir, instanceId), 'utf8'));
}

function preserveEnvironment(names) {
  const before = new Map(names.map((name) => [name, process.env[name]]));
  return () => {
    for (const [name, value] of before) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}

test('multi-gate resume consumes the old checkpoint and rejects token replay', async () => {
  const { root, sessionsDir, engine } = createHarness(2);
  const restoreEnvironment = preserveEnvironment(['DSH_SESSIONS_DIR', 'DSH_AUDIT_LOG_FILE', 'DSH_AUDIT_INTEGRITY_KEY']);
  process.env.DSH_SESSIONS_DIR = sessionsDir;
  process.env.DSH_AUDIT_LOG_FILE = path.join(root, 'audit.jsonl');
  process.env.DSH_AUDIT_INTEGRITY_KEY = 'phase-3-audit-integrity-key-32-bytes';
  const secret = 'phase-3-replay-secret-at-least-32-bytes';
  let mutationCount = 0;
  engine.registerAction('contain_threat', async () => {
    mutationCount += 1;
    return { contained: true };
  });

  try {
    const first = await engine.executeWorkflow('guarded');
    const firstCheckpoint = readCheckpoint(sessionsDir, first.instanceId);
    assert.equal(fs.statSync(checkpointPath(sessionsDir, first.instanceId)).mode & 0o777, 0o600);
    const firstToken = DeclarativeWorkflowEngine.generateApprovalToken(firstCheckpoint, 'reviewer', 3600, secret);

    const second = await engine.resumeWorkflow(first.instanceId, { token: firstToken, approvalSecret: secret });
    assert.equal(second.status, 'SUSPENDED_APPROVAL_REQUIRED');
    assert.notEqual(second.instanceId, first.instanceId);
    assert.equal(mutationCount, 1, 'the first approved mutation must run exactly once');

    const consumedFirst = readCheckpoint(sessionsDir, first.instanceId);
    const suspendedSecond = readCheckpoint(sessionsDir, second.instanceId);
    assert.equal(consumedFirst.status, 'CONSUMED');
    assert.ok(consumedFirst.consumedAt);
    assert.equal(consumedFirst.successorInstanceId, second.instanceId);
    assert.equal(suspendedSecond.status, 'SUSPENDED_APPROVAL_REQUIRED');
    assert.equal(fs.statSync(checkpointPath(sessionsDir, second.instanceId)).mode & 0o777, 0o600);

    await assert.rejects(
      () => engine.resumeWorkflow(first.instanceId, { token: firstToken, approvalSecret: secret }),
      /APPROVAL_CHECKPOINT_CONSUMED|replays rejected/
    );
    assert.equal(mutationCount, 1, 'replaying the first token must not repeat its mutation');

    const secondToken = DeclarativeWorkflowEngine.generateApprovalToken(suspendedSecond, 'reviewer', 3600, secret);
    const completed = await engine.resumeWorkflow(second.instanceId, { token: secondToken, approvalSecret: secret });
    assert.equal(completed.status, 'COMPLETED');
    assert.equal(mutationCount, 2);
    assert.equal(readCheckpoint(sessionsDir, second.instanceId).status, 'CONSUMED');
  } finally {
    restoreEnvironment();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('checkpoint status rollback is detected by the state-bound digest', async () => {
  const { root, sessionsDir, engine } = createHarness(1);
  const restoreEnvironment = preserveEnvironment(['DSH_SESSIONS_DIR', 'DSH_AUDIT_LOG_FILE', 'DSH_AUDIT_INTEGRITY_KEY']);
  process.env.DSH_SESSIONS_DIR = sessionsDir;
  process.env.DSH_AUDIT_LOG_FILE = path.join(root, 'audit.jsonl');
  process.env.DSH_AUDIT_INTEGRITY_KEY = 'phase-3-audit-integrity-key-32-bytes';
  const secret = 'phase-3-state-binding-secret-32-bytes';
  engine.registerAction('contain_threat', async () => ({ contained: true }));

  try {
    const suspended = await engine.executeWorkflow('guarded');
    const initialCheckpoint = readCheckpoint(sessionsDir, suspended.instanceId);
    const token = DeclarativeWorkflowEngine.generateApprovalToken(initialCheckpoint, 'reviewer', 3600, secret);
    await engine.resumeWorkflow(suspended.instanceId, { token, approvalSecret: secret });

    const consumed = readCheckpoint(sessionsDir, suspended.instanceId);
    assert.equal(consumed.status, 'CONSUMED');
    consumed.status = 'SUSPENDED_APPROVAL_REQUIRED';
    fs.writeFileSync(checkpointPath(sessionsDir, suspended.instanceId), JSON.stringify(consumed, null, 2), 'utf8');

    await assert.rejects(
      () => engine.resumeWorkflow(suspended.instanceId, { token, approvalSecret: secret }),
      /checkpoint content has been tampered with \(digest mismatch\)/
    );
  } finally {
    restoreEnvironment();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('production verification discovers the public key from DSH_CONFIG_DIR', async () => {
  const { root, sessionsDir, engine } = createHarness(1);
  const restoreEnvironment = preserveEnvironment([
    'DSH_SESSIONS_DIR',
    'DSH_AUDIT_LOG_FILE',
    'DSH_AUDIT_INTEGRITY_KEY',
    'DSH_CONFIG_DIR',
    'DSH_APPROVAL_PUBLIC_KEY_FILE',
    'DSH_APPROVAL_PUBLIC_KEY',
    'DSH_APPROVAL_SECRET',
    'DSH_SECRET',
    'NODE_ENV',
    'DSH_SANDBOX'
  ]);
  const configDir = path.join(root, 'config');
  const keyDir = path.join(configDir, 'keys');
  fs.mkdirSync(keyDir, { recursive: true });
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  fs.writeFileSync(path.join(keyDir, 'approval_ed25519.pub'), publicKey, { mode: 0o644 });
  engine.registerAction('contain_threat', async () => ({ contained: true }));

  process.env.DSH_SESSIONS_DIR = sessionsDir;
  process.env.DSH_AUDIT_LOG_FILE = path.join(root, 'audit.jsonl');
  process.env.DSH_AUDIT_INTEGRITY_KEY = 'phase-3-audit-integrity-key-32-bytes';
  process.env.DSH_CONFIG_DIR = configDir;
  process.env.NODE_ENV = 'production';
  delete process.env.DSH_SANDBOX;
  delete process.env.DSH_APPROVAL_PUBLIC_KEY_FILE;
  delete process.env.DSH_APPROVAL_PUBLIC_KEY;
  delete process.env.DSH_APPROVAL_SECRET;
  delete process.env.DSH_SECRET;

  try {
    const suspended = await engine.executeWorkflow('guarded');
    const checkpoint = readCheckpoint(sessionsDir, suspended.instanceId);
    const token = DeclarativeWorkflowEngine.generateApprovalToken(checkpoint, 'host-admin', 3600, privateKey);
    const resumed = await engine.resumeWorkflow(suspended.instanceId, { token });
    assert.equal(resumed.status, 'COMPLETED');
  } finally {
    restoreEnvironment();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('pre-v2 approval checkpoints fail closed with migration guidance', async () => {
  const { root, sessionsDir, engine } = createHarness(1);
  const restoreEnvironment = preserveEnvironment(['DSH_SESSIONS_DIR', 'DSH_AUDIT_LOG_FILE', 'DSH_AUDIT_INTEGRITY_KEY']);
  process.env.DSH_SESSIONS_DIR = sessionsDir;
  process.env.DSH_AUDIT_LOG_FILE = path.join(root, 'audit.jsonl');
  process.env.DSH_AUDIT_INTEGRITY_KEY = 'phase-3-audit-integrity-key-32-bytes';
  engine.registerAction('contain_threat', async () => ({ contained: true }));

  try {
    const suspended = await engine.executeWorkflow('guarded');
    const checkpoint = readCheckpoint(sessionsDir, suspended.instanceId);
    delete checkpoint.checkpointVersion;
    fs.writeFileSync(checkpointPath(sessionsDir, suspended.instanceId), JSON.stringify(checkpoint, null, 2), 'utf8');

    await assert.rejects(
      () => engine.resumeWorkflow(suspended.instanceId, { token: 'reviewer.9999999999999.invalid' }),
      /APPROVAL_CHECKPOINT_VERSION_UNSUPPORTED.*Restart the suspended workflow/
    );
  } finally {
    restoreEnvironment();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('production verification refuses agent-writable development key fallbacks', async () => {
  const { root, sessionsDir, engine } = createHarness(1);
  const originalCwd = process.cwd();
  const restoreEnvironment = preserveEnvironment([
    'DSH_SESSIONS_DIR', 'DSH_AUDIT_LOG_FILE', 'DSH_AUDIT_INTEGRITY_KEY',
    'DSH_CONFIG_DIR', 'DSH_CONFIG_SOURCE', 'DSH_APPROVAL_PUBLIC_KEY_FILE',
    'DSH_APPROVAL_PUBLIC_KEY', 'DSH_APPROVAL_SECRET', 'DSH_SECRET',
    'NODE_ENV', 'DSH_SANDBOX'
  ]);
  const writableKeyDir = path.join(root, 'config', 'keys');
  fs.mkdirSync(writableKeyDir, { recursive: true });
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  fs.writeFileSync(path.join(writableKeyDir, 'approval_ed25519.pub'), publicKey, 'utf8');
  engine.registerAction('contain_threat', async () => ({ contained: true }));

  process.env.DSH_SESSIONS_DIR = sessionsDir;
  process.env.DSH_AUDIT_LOG_FILE = path.join(root, 'audit.jsonl');
  process.env.DSH_AUDIT_INTEGRITY_KEY = 'phase-3-audit-integrity-key-32-bytes';
  process.env.DSH_CONFIG_DIR = path.join(root, 'missing-config');
  process.env.DSH_CONFIG_SOURCE = path.join(root, 'missing-source');
  process.env.NODE_ENV = 'production';
  delete process.env.DSH_SANDBOX;
  delete process.env.DSH_APPROVAL_PUBLIC_KEY_FILE;
  delete process.env.DSH_APPROVAL_PUBLIC_KEY;
  delete process.env.DSH_APPROVAL_SECRET;
  delete process.env.DSH_SECRET;

  try {
    process.chdir(root);
    const suspended = await engine.executeWorkflow('guarded');
    const checkpoint = readCheckpoint(sessionsDir, suspended.instanceId);
    const token = DeclarativeWorkflowEngine.generateApprovalToken(checkpoint, 'host-admin', 3600, privateKey);
    await assert.rejects(
      () => engine.resumeWorkflow(suspended.instanceId, { token }),
      /DSH_APPROVAL_PUBLIC_KEY is required in container environment/
    );
  } finally {
    process.chdir(originalCwd);
    restoreEnvironment();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
