#!/usr/bin/env node
import http from 'node:http';
import https from 'node:https';

export function submitAuditEvent({ url, token, event, timeoutMs = 4000 }) {
  return new Promise((resolve, reject) => {
    if (typeof token !== 'string' || token.length < 32) {
      reject(new Error('GRC_AUDIT_WRITE_FAILED: audit writer token is missing or too short'));
      return;
    }
    let endpoint;
    try { endpoint = new URL(url); }
    catch { reject(new Error('GRC_AUDIT_WRITE_FAILED: audit writer URL is invalid')); return; }
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.pathname !== '/v1/events') {
      reject(new Error('GRC_AUDIT_WRITE_FAILED: audit writer endpoint is not allowed'));
      return;
    }
    const transport = endpoint.protocol === 'https:' ? https : http;
    const body = JSON.stringify({ event });
    const request = transport.request(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body)
      },
      timeout: timeoutMs
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > 131072) request.destroy(new Error('audit writer response too large'));
        else chunks.push(chunk);
      });
      response.on('end', () => {
        let payload;
        try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { reject(new Error('GRC_AUDIT_WRITE_FAILED: audit writer returned invalid JSON')); return; }
        if (response.statusCode !== 201 || !payload.entry) {
          reject(new Error(`GRC_AUDIT_WRITE_FAILED: audit writer refused the event (${payload.error || response.statusCode})`));
          return;
        }
        resolve(payload.entry);
      });
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', () => reject(new Error('GRC_AUDIT_WRITE_FAILED: audit writer unavailable')));
    request.end(body);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  try {
    const event = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const entry = await submitAuditEvent({
      url: process.env.DSH_AUDIT_WRITER_URL || '',
      token: process.env.DSH_AUDIT_WRITER_TOKEN || '',
      event
    });
    process.stdout.write(JSON.stringify(entry));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
