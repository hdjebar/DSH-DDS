#!/usr/bin/env node
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { AuditLedger, authenticated } from './audit-writer-core.mjs';

async function readJsonRequest(request, maxBodyBytes) {
  const chunks = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) tooLarge = true;
    else chunks.push(chunk);
  }
  if (tooLarge) throw new Error('request_too_large');
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('invalid_json'); }
}

function send(response, status, body) {
  if (response.writableEnded) return;
  const serialized = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(serialized) });
  response.end(serialized);
}

export function createAuditWriterHandler({ ledger, token, maxBodyBytes = 65536 }) {
  if (!ledger || typeof ledger.append !== 'function') throw new Error('AUDIT_CONFIG_INVALID: ledger is required');
  if (typeof token !== 'string' || token.length < 32) {
    throw new Error('AUDIT_CONFIG_INVALID: writer token must contain at least 32 characters');
  }
  let queue = Promise.resolve();

  return async (request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      send(response, 200, { ok: true });
      return;
    }
    if (request.method !== 'POST' || request.url !== '/v1/events') {
      send(response, 404, { error: 'not_found' });
      return;
    }
    const supplied = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!authenticated(supplied, token)) {
      send(response, 401, { error: 'unauthorized' });
      request.resume?.();
      return;
    }

    let payload;
    try {
      payload = await readJsonRequest(request, maxBodyBytes);
    } catch (error) {
      send(response, error.message === 'request_too_large' ? 413 : 400, { error: error.message });
      return;
    }

    const operation = queue.catch(() => {}).then(() => ledger.append(payload.event));
    queue = operation.then(() => {}, () => {});
    try {
      send(response, 201, { entry: await operation });
    } catch (error) {
      // Never return filesystem paths, key material, or internal exception details.
      const integrityFailure = String(error?.message || '').startsWith('AUDIT_INTEGRITY_FAILED');
      send(response, integrityFailure ? 409 : 400, {
        error: integrityFailure ? 'integrity_failure' : 'invalid_event'
      });
    }
  };
}

export function createAuditWriterServer(options = {}) {
  const ledger = options.ledger || new AuditLedger({
    auditFile: options.auditFile || process.env.DSH_AUDIT_LOG_FILE || '/var/lib/dsh/audit/audit_grc.jsonl',
    checkpointFile: options.checkpointFile || process.env.DSH_AUDIT_CHECKPOINT_FILE || '/var/lib/dsh/checkpoints/audit_head.jsonl',
    integrityKey: options.integrityKey || process.env.DSH_AUDIT_INTEGRITY_KEY || ''
  });
  const token = options.token || process.env.DSH_AUDIT_WRITER_TOKEN || '';
  const server = http.createServer(createAuditWriterHandler({ ledger, token, maxBodyBytes: options.maxBodyBytes }));
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  return server;
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const host = process.env.DSH_AUDIT_WRITER_HOST || '0.0.0.0';
  const port = Number(process.env.DSH_AUDIT_WRITER_PORT || 3091);
  createAuditWriterServer().listen(port, host);
}
