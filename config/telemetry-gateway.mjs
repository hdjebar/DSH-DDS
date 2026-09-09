import http from 'node:http';
import { pathToFileURL } from 'node:url';

const DEFAULT_MAX_BODY_BYTES = 8 * 1024 * 1024;

function sendJson(res, statusCode, payload) {
  if (res.writableEnded) return;
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function normalizeUpstream(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('PHOENIX_UPSTREAM_URL must be a valid URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('PHOENIX_UPSTREAM_URL must use HTTP(S) without embedded credentials');
  }
  parsed.pathname = '/v1/traces';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

async function readBody(req, maxBodyBytes) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBodyBytes) {
    const error = new Error('Telemetry payload too large');
    error.code = 'PAYLOAD_TOO_LARGE';
    throw error;
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBodyBytes) {
      const error = new Error('Telemetry payload too large');
      error.code = 'PAYLOAD_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createTelemetryGatewayHandler(options = {}) {
  const upstreamUrl = normalizeUpstream(options.upstreamUrl || process.env.PHOENIX_UPSTREAM_URL || 'http://phoenix:6006');
  const upstreamToken = options.upstreamToken || process.env.PHOENIX_INGEST_TOKEN || '';
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const maxBodyBytes = options.maxBodyBytes || DEFAULT_MAX_BODY_BYTES;
  const timeoutMs = options.timeoutMs || 5000;

  if (typeof upstreamToken !== 'string' || upstreamToken.length < 32) {
    throw new Error('PHOENIX_INGEST_TOKEN must contain at least 32 characters');
  }
  if (typeof fetchImpl !== 'function') throw new Error('Fetch API is unavailable');

  return async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, { status: 'healthy' });
      return;
    }
    if (req.method !== 'POST' || req.url !== '/v1/traces') {
      sendJson(res, 403, { error: 'TELEMETRY_ROUTE_DENIED' });
      return;
    }

    const contentType = String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
    if (!['application/json', 'application/x-protobuf'].includes(contentType)) {
      sendJson(res, 415, { error: 'TELEMETRY_CONTENT_TYPE_DENIED' });
      return;
    }
    const contentEncoding = String(req.headers['content-encoding'] || 'identity').trim().toLowerCase();
    if (contentEncoding !== 'identity') {
      sendJson(res, 415, { error: 'TELEMETRY_CONTENT_ENCODING_DENIED' });
      return;
    }

    try {
      const body = await readBody(req, maxBodyBytes);
      const headers = {
        'Content-Type': contentType,
        'Authorization': `Bearer ${upstreamToken}`
      };
      const upstream = await fetchImpl(upstreamUrl, {
        method: 'POST',
        headers,
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs)
      });
      res.statusCode = upstream.ok ? 202 : 502;
      res.end();
      await upstream.body?.cancel();
    } catch (error) {
      if (error?.code === 'PAYLOAD_TOO_LARGE') {
        sendJson(res, 413, { error: error.code });
      } else {
        sendJson(res, 502, { error: 'TELEMETRY_UPSTREAM_FAILED' });
      }
    }
  };
}

export function createTelemetryGateway(options = {}) {
  const server = http.createServer(createTelemetryGatewayHandler(options));
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  return server;
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const port = Number(process.env.PORT || 4318);
  const server = createTelemetryGateway();
  server.listen(port, '0.0.0.0', () => {
    process.stdout.write(`telemetry-gateway listening on ${port}\n`);
  });
}
