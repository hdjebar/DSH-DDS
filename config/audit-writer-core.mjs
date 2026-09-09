import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ALLOWED_DECISIONS = new Set(['GRANTED', 'DENIED', 'GATED', 'EVALUATED_OK']);
const ALLOWED_FIELDS = new Set([
  'persona', 'workflow', 'step_index', 'step_name', 'action', 'target',
  'decision', 'role', 'reason', 'trace_id'
]);
const MAX_STRING_LENGTH = 8192;
const FULL_VERIFY_INTERVAL = 256;

function fileState(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return { size: stat.size, ino: stat.ino };
  } catch (error) {
    if (error.code === 'ENOENT') return { size: 0, ino: null };
    throw error;
  }
}

function hmac(key, value) {
  return crypto.createHmac('sha256', key).update(value).digest('hex');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`AUDIT_SCHEMA_INVALID: ${label} must be a plain object`);
  }
}

export function validateAuditEvent(value) {
  assertPlainObject(value, 'event');
  for (const key of Object.keys(value)) {
    if (!ALLOWED_FIELDS.has(key)) throw new Error(`AUDIT_SCHEMA_INVALID: unsupported field '${key}'`);
  }
  if (!ALLOWED_DECISIONS.has(value.decision)) {
    throw new Error('AUDIT_SCHEMA_INVALID: decision is not recognized');
  }
  if (typeof value.reason !== 'string' || value.reason.length === 0 || value.reason.length > MAX_STRING_LENGTH) {
    throw new Error('AUDIT_SCHEMA_INVALID: reason must be a non-empty bounded string');
  }
  for (const [key, item] of Object.entries(value)) {
    if (key === 'step_index') {
      if (!Number.isSafeInteger(item) || item < 0) throw new Error('AUDIT_SCHEMA_INVALID: step_index must be a non-negative integer');
      continue;
    }
    if (item !== null && (typeof item !== 'string' || item.length > MAX_STRING_LENGTH)) {
      throw new Error(`AUDIT_SCHEMA_INVALID: '${key}' must be a bounded string or null`);
    }
  }
  return { ...value };
}

function atomicAppend(filePath, record) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(filePath, 'a', 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(record)}\n`, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf8');
  if (text && !text.endsWith('\n')) throw new Error(`AUDIT_INTEGRITY_FAILED: '${filePath}' has a partial tail`);
  return text.split('\n').filter(Boolean).map((raw) => {
    try { return { raw, value: JSON.parse(raw) }; }
    catch { throw new Error(`AUDIT_INTEGRITY_FAILED: '${filePath}' contains malformed JSON`); }
  });
}

export function verifyAuditLedger(auditFile, integrityKey) {
  if (!integrityKey) return { valid: false, reason: 'integrity key required' };
  let records;
  try { records = readJsonLines(auditFile); }
  catch (error) { return { valid: false, reason: error.message }; }
  let previousHash = null;
  let sequence = 0;
  let protectedEntries = 0;
  for (const { raw, value: entry } of records) {
    if (!entry.entry_hash) {
      return { valid: false, reason: 'legacy unhashed entries must be archived before enabling the external writer' };
    }
    if (entry.sequence !== sequence + 1) return { valid: false, reason: 'sequence mismatch' };
    if (entry.previous_hash !== previousHash) return { valid: false, reason: 'previous hash mismatch' };
    const { entry_hash: storedHash, ...unsigned } = entry;
    if (entry.integrity_algorithm === 'sha256' && protectedEntries === 0) {
      const digest = crypto.createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
      if (!safeEqual(storedHash, digest)) return { valid: false, reason: 'entry hash mismatch' };
    } else if (entry.integrity_algorithm === 'hmac-sha256') {
      if (!safeEqual(storedHash, hmac(integrityKey, JSON.stringify(unsigned)))) {
        return { valid: false, reason: 'entry HMAC mismatch' };
      }
      protectedEntries += 1;
    } else {
      return { valid: false, reason: 'integrity algorithm downgrade or unsupported algorithm' };
    }
    sequence = entry.sequence;
    previousHash = storedHash;
  }
  return { valid: true, entries: records.length, protectedEntries, sequence, head: previousHash };
}

export function verifyCheckpointLedger(checkpointFile, integrityKey) {
  if (!integrityKey) return { valid: false, reason: 'integrity key required' };
  let records;
  try { records = readJsonLines(checkpointFile); }
  catch (error) { return { valid: false, reason: error.message }; }
  let previousCheckpointHash = null;
  let last = null;
  for (const { value: checkpoint } of records) {
    const { checkpoint_hmac: storedHmac, ...unsigned } = checkpoint;
    if (!storedHmac || checkpoint.previous_checkpoint_hash !== previousCheckpointHash) {
      return { valid: false, reason: 'checkpoint chain mismatch' };
    }
    if (!safeEqual(storedHmac, hmac(integrityKey, JSON.stringify(unsigned)))) {
      return { valid: false, reason: 'checkpoint HMAC mismatch' };
    }
    previousCheckpointHash = storedHmac;
    last = checkpoint;
  }
  return { valid: true, checkpoints: records.length, last };
}

export class AuditLedger {
  constructor({ auditFile, checkpointFile, integrityKey }) {
    if (!auditFile || !checkpointFile) throw new Error('AUDIT_CONFIG_INVALID: ledger paths are required');
    if (typeof integrityKey !== 'string' || integrityKey.length < 32) {
      throw new Error('AUDIT_CONFIG_INVALID: integrity key must contain at least 32 characters');
    }
    if (path.resolve(auditFile) === path.resolve(checkpointFile)) {
      throw new Error('AUDIT_CONFIG_INVALID: checkpoint storage must be separate from the audit file');
    }
    this.auditFile = auditFile;
    this.checkpointFile = checkpointFile;
    this.integrityKey = integrityKey;
    this.assertConsistent();
  }

  assertConsistent() {
    const audit = verifyAuditLedger(this.auditFile, this.integrityKey);
    const checkpoints = verifyCheckpointLedger(this.checkpointFile, this.integrityKey);
    if (!audit.valid) throw new Error(`AUDIT_INTEGRITY_FAILED: ${audit.reason}`);
    if (!checkpoints.valid) throw new Error(`AUDIT_INTEGRITY_FAILED: ${checkpoints.reason}`);
    this.checkpointHead = checkpoints.last?.checkpoint_hmac || null;
    if (checkpoints.last) {
      const matches = checkpoints.last.audit_sequence === audit.sequence
        && checkpoints.last.audit_head === audit.head
        && checkpoints.last.audit_size === fs.statSync(this.auditFile).size;
      if (!matches) {
        // The ledger append is fsync'd before its checkpoint. A crash in that narrow window
        // can leave exactly one valid HMAC entry ahead of the last durable checkpoint. Recover
        // only that provable state; every other divergence remains fail-closed.
        const records = readJsonLines(this.auditFile);
        const last = records.at(-1)?.value;
        const recoverable = audit.sequence === checkpoints.last.audit_sequence + 1
          && last?.sequence === audit.sequence
          && last?.previous_hash === checkpoints.last.audit_head
          && checkpoints.last.audit_size < fs.statSync(this.auditFile).size;
        if (!recoverable) throw new Error('AUDIT_INTEGRITY_FAILED: audit tail does not match the external checkpoint');
        this.sequence = audit.sequence;
        this.head = audit.head;
        this.writeCheckpoint(this.sequence, this.head);
      }
    } else if (audit.entries > 0) {
      // The first deployment can anchor an existing fully verified HMAC ledger. Any
      // truncation before this bootstrap is outside the evidence boundary.
      this.writeCheckpoint(audit.sequence, audit.head);
    }
    this.sequence = audit.sequence;
    this.head = audit.head;
    this.auditState = fileState(this.auditFile);
    this.checkpointState = fileState(this.checkpointFile);
    this.appendsSinceFullVerification = 0;
  }

  assertStorageUnchanged() {
    const auditState = fileState(this.auditFile);
    const checkpointState = fileState(this.checkpointFile);
    const unchanged = auditState.size === this.auditState.size
      && auditState.ino === this.auditState.ino
      && checkpointState.size === this.checkpointState.size
      && checkpointState.ino === this.checkpointState.ino;
    if (!unchanged) throw new Error('AUDIT_INTEGRITY_FAILED: audit storage changed outside the writer');
  }

  writeCheckpoint(sequence, auditHead) {
    const unsigned = {
      timestamp: new Date().toISOString(),
      audit_sequence: sequence,
      audit_head: auditHead,
      audit_size: fs.statSync(this.auditFile).size,
      previous_checkpoint_hash: this.checkpointHead || null
    };
    const checkpoint = { ...unsigned, checkpoint_hmac: hmac(this.integrityKey, JSON.stringify(unsigned)) };
    atomicAppend(this.checkpointFile, checkpoint);
    this.checkpointHead = checkpoint.checkpoint_hmac;
    this.checkpointState = fileState(this.checkpointFile);
    return checkpoint;
  }

  append(event) {
    const clean = validateAuditEvent(event);
    // The writer is the exclusive mount owner. Check file identity and size on every grant,
    // and periodically perform a complete HMAC-chain verification so lifetime append cost is
    // linear rather than quadratic. Startup always performs a full verification.
    if (this.appendsSinceFullVerification >= FULL_VERIFY_INTERVAL) this.assertConsistent();
    else this.assertStorageUnchanged();
    const unsigned = {
      timestamp: new Date().toISOString(),
      event_type: 'GRC_AUTHORIZATION_DECISION',
      ...clean,
      sequence: this.sequence + 1,
      previous_hash: this.head,
      integrity_algorithm: 'hmac-sha256'
    };
    const entry = { ...unsigned, entry_hash: hmac(this.integrityKey, JSON.stringify(unsigned)) };
    atomicAppend(this.auditFile, entry);
    this.sequence = entry.sequence;
    this.head = entry.entry_hash;
    this.auditState = fileState(this.auditFile);
    this.writeCheckpoint(this.sequence, this.head);
    this.appendsSinceFullVerification += 1;
    return entry;
  }
}

export function authenticated(token, expectedToken) {
  return typeof token === 'string' && typeof expectedToken === 'string' && expectedToken.length >= 32
    && safeEqual(token, expectedToken);
}
