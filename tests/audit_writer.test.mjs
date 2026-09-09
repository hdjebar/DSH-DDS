import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
  AuditLedger,
  validateAuditEvent,
  verifyAuditLedger,
  verifyCheckpointLedger
} from '../config/audit-writer-core.mjs';
import { createAuditWriterHandler } from '../config/audit-writer.mjs';
import { logGrcAuditEvent, logGrcAuditEventBestEffort } from '../config/rbac-policy.mjs';

const KEY = 'test-audit-integrity-key-that-is-at-least-32-bytes';
const TOKEN = 'test-audit-writer-token-that-is-at-least-32-bytes';

function event(overrides = {}) {
  return {
    persona: 'security-auditor',
    workflow: 'incident-triage',
    action: 'read_file',
    target: '/workspaces/cases/one.md',
    decision: 'GRANTED',
    role: 'security_auditor',
    reason: 'Policy validated',
    trace_id: '1'.repeat(32),
    ...overrides
  };
}

async function invoke(handler, { method = 'POST', url = '/v1/events', token = TOKEN, body = {} } = {}) {
  const request = Readable.from([Buffer.from(JSON.stringify(body))]);
  request.method = method;
  request.url = url;
  request.headers = token ? { authorization: `Bearer ${token}` } : {};
  let responseBody = '';
  const response = {
    statusCode: 0,
    writableEnded: false,
    headers: {},
    writeHead(statusCode, headers) { this.statusCode = statusCode; this.headers = headers; return this; },
    end(value = '') { responseBody += value; this.writableEnded = true; }
  };
  await handler(request, response);
  return { statusCode: response.statusCode, body: JSON.parse(responseBody) };
}

test('audit writer validates schema and creates separately chained checkpoints', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-audit-ledger-'));
  const auditFile = path.join(root, 'audit', 'events.jsonl');
  const checkpointFile = path.join(root, 'checkpoints', 'heads.jsonl');
  try {
    const ledger = new AuditLedger({ auditFile, checkpointFile, integrityKey: KEY });
    const first = ledger.append(event());
    const second = ledger.append(event({ decision: 'DENIED', reason: 'Tenant mismatch' }));
    assert.equal(first.sequence, 1);
    assert.equal(second.previous_hash, first.entry_hash);
    assert.deepEqual(verifyAuditLedger(auditFile, KEY), {
      valid: true,
      entries: 2,
      protectedEntries: 2,
      sequence: 2,
      head: second.entry_hash
    });
    const checkpoints = verifyCheckpointLedger(checkpointFile, KEY);
    assert.equal(checkpoints.valid, true);
    assert.equal(checkpoints.checkpoints, 2);
    assert.equal(checkpoints.last.audit_head, second.entry_hash);
    assert.throws(() => validateAuditEvent(event({ api_key: 'must-not-be-accepted' })), /unsupported field/);

    const records = fs.readFileSync(auditFile, 'utf8').trim().split('\n');
    fs.writeFileSync(auditFile, `${records[0]}\n`);
    assert.throws(
      () => new AuditLedger({ auditFile, checkpointFile, integrityKey: KEY }),
      /audit tail does not match the external checkpoint/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('audit writer handler authenticates, validates, serializes, and avoids secret leakage', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-audit-service-'));
  try {
    const ledger = new AuditLedger({
      auditFile: path.join(root, 'audit', 'events.jsonl'),
      checkpointFile: path.join(root, 'checkpoints', 'heads.jsonl'),
      integrityKey: KEY
    });
    const handler = createAuditWriterHandler({ ledger, token: TOKEN });
    assert.equal((await invoke(handler, { token: `${TOKEN}-wrong`, body: { event: event() } })).statusCode, 401);
    const invalid = await invoke(handler, { body: { event: event({ api_key: 'rejected' }) } });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.body.error, 'invalid_event');
    assert.doesNotMatch(JSON.stringify(invalid.body), /api_key|rejected|audit-service/);
    const [first, second] = await Promise.all([
      invoke(handler, { body: { event: event() } }),
      invoke(handler, { body: { event: event({ decision: 'DENIED', reason: 'Denied' }) } })
    ]);
    assert.equal(first.statusCode, 201);
    assert.equal(second.statusCode, 201);
    assert.deepEqual([first.body.entry.sequence, second.body.entry.sequence], [1, 2]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('audit writer recovers only a single fully verified entry after a checkpoint crash window', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-audit-recovery-'));
  const auditFile = path.join(root, 'audit', 'events.jsonl');
  const checkpointFile = path.join(root, 'checkpoints', 'heads.jsonl');
  try {
    const ledger = new AuditLedger({ auditFile, checkpointFile, integrityKey: KEY });
    ledger.append(event());
    const checkpoint = fs.readFileSync(checkpointFile, 'utf8');
    ledger.append(event({ decision: 'DENIED', reason: 'Denied' }));
    fs.writeFileSync(checkpointFile, checkpoint);
    const recovered = new AuditLedger({ auditFile, checkpointFile, integrityKey: KEY });
    assert.equal(recovered.sequence, 2);
    assert.equal(verifyCheckpointLedger(checkpointFile, KEY).last.audit_sequence, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('audit writer refuses unanchored legacy records', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-audit-legacy-'));
  const auditFile = path.join(root, 'audit', 'events.jsonl');
  const checkpointFile = path.join(root, 'checkpoints', 'heads.jsonl');
  try {
    fs.mkdirSync(path.dirname(auditFile), { recursive: true });
    fs.writeFileSync(auditFile, `${JSON.stringify(event())}\n`);
    assert.throws(
      () => new AuditLedger({ auditFile, checkpointFile, integrityKey: KEY }),
      /legacy unhashed entries/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('required external writer preserves fail-closed grants and best-effort denials when unavailable', () => {
  const previous = {
    url: process.env.DSH_AUDIT_WRITER_URL,
    token: process.env.DSH_AUDIT_WRITER_TOKEN,
    required: process.env.DSH_AUDIT_WRITER_REQUIRED
  };
  process.env.DSH_AUDIT_WRITER_URL = 'http://127.0.0.1:1/v1/events';
  process.env.DSH_AUDIT_WRITER_TOKEN = TOKEN;
  process.env.DSH_AUDIT_WRITER_REQUIRED = '1';
  try {
    assert.throws(() => logGrcAuditEvent(event()), /GRC_AUDIT_WRITE_FAILED/);
    assert.doesNotThrow(() => logGrcAuditEventBestEffort(event({ decision: 'DENIED', reason: 'Policy denied' })));
  } finally {
    for (const [key, value] of Object.entries({
      DSH_AUDIT_WRITER_URL: previous.url,
      DSH_AUDIT_WRITER_TOKEN: previous.token,
      DSH_AUDIT_WRITER_REQUIRED: previous.required
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
