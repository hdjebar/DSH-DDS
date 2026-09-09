import crypto from 'node:crypto';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { deriveUserPartitionId } from './iam.js';

const capabilityContext = new AsyncLocalStorage();
const TOKEN_VERSION = 1;
const DEFAULT_TTL_MS = 30_000;

function capabilityKey() {
  const key = process.env.DSH_EXECUTOR_CAPABILITY_KEY;
  if (typeof key !== 'string' || Buffer.byteLength(key, 'utf8') < 32) {
    throw new Error('DSH_EXECUTOR_CAPABILITY_KEY must contain at least 32 bytes');
  }
  return key;
}

export function assertExecutionCapabilityKey() {
  capabilityKey();
}

function signature(encodedPayload) {
  return crypto.createHmac('sha256', capabilityKey()).update(encodedPayload).digest('base64url');
}

function safeEqual(left, right) {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function issueExecutionCapability({ user, workdir, ttlMs = DEFAULT_TTL_MS, now = Date.now() }) {
  if (!user?.id || typeof workdir !== 'string' || !path.isAbsolute(workdir)) {
    throw new Error('Execution capabilities require an authenticated user and absolute workdir');
  }
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > 60_000) {
    throw new Error('Execution capability TTL must be between 1 and 60000 milliseconds');
  }
  const issuer = user.issuer || user.iss || 'dsh-local';
  const payload = {
    v: TOKEN_VERSION,
    sub: String(user.id),
    iss: String(issuer),
    partition: deriveUserPartitionId(user.id, issuer),
    roles: Array.isArray(user.roles) ? user.roles.filter(role => typeof role === 'string') : ['user'],
    workdir: path.resolve(workdir),
    iat: now,
    exp: now + ttlMs,
    nonce: crypto.randomBytes(18).toString('base64url')
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encoded}.${signature(encoded)}`;
}

export function verifyExecutionCapability(token, { workdir, now = Date.now() } = {}) {
  if (typeof token !== 'string') throw new Error('Missing execution capability');
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1] || !safeEqual(parts[1], signature(parts[0]))) {
    throw new Error('Invalid execution capability signature');
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch {
    throw new Error('Malformed execution capability');
  }
  if (payload.v !== TOKEN_VERSION || typeof payload.nonce !== 'string' || typeof payload.partition !== 'string') {
    throw new Error('Unsupported execution capability');
  }
  if (typeof payload.sub !== 'string' || typeof payload.iss !== 'string'
    || payload.partition !== deriveUserPartitionId(payload.sub, payload.iss)) {
    throw new Error('Execution capability identity binding is invalid');
  }
  if (!Number.isFinite(payload.iat) || !Number.isFinite(payload.exp) || payload.iat > now + 5_000 || payload.exp < now) {
    throw new Error('Expired execution capability');
  }
  if (payload.exp - payload.iat > 60_000) throw new Error('Execution capability lifetime exceeds policy');
  if (typeof payload.workdir !== 'string' || !path.isAbsolute(payload.workdir)) {
    throw new Error('Execution capability has an invalid workdir');
  }
  if (workdir && path.resolve(workdir) !== path.resolve(payload.workdir)) {
    throw new Error('Execution capability does not authorize this workdir');
  }
  return Object.freeze(payload);
}

export function runWithExecutionCapability(token, callback) {
  if (typeof callback !== 'function') throw new Error('Execution capability callback is required');
  return capabilityContext.run(token, callback);
}

export function getCurrentExecutionCapability() {
  return capabilityContext.getStore() || null;
}
