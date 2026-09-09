import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createTelemetryGateway, createTelemetryGatewayHandler } from '../config/telemetry-gateway.mjs';

function createHandler(fetchImpl, options = {}) {
  return createTelemetryGatewayHandler({
    upstreamUrl: 'http://phoenix:6006',
    upstreamToken: 'dsh0_test-phoenix-ingest-token-000000000000',
    fetchImpl,
    ...options
  });
}

async function invoke(handler, { method = 'GET', url = '/', headers = {}, body = '' } = {}) {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = method;
  req.url = url;
  req.headers = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  let responseBody = '';
  const res = {
    statusCode: 200,
    writableEnded: false,
    headers: {},
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    end(value = '') { responseBody += value; this.writableEnded = true; }
  };
  await handler(req, res);
  return { status: res.statusCode, headers: res.headers, body: responseBody };
}

test('Telemetry gateway exposes health but blocks Phoenix management routes', async () => {
  let upstreamCalls = 0;
  const handler = createHandler(async () => {
    upstreamCalls += 1;
    return new Response(null, { status: 200 });
  });
  assert.equal((await invoke(handler, { url: '/health' })).status, 200);
  assert.equal((await invoke(handler, { method: 'POST', url: '/graphql' })).status, 403);
  assert.equal((await invoke(handler, { url: '/v1/projects' })).status, 403);
  assert.equal(upstreamCalls, 0);
});

test('Telemetry gateway forwards only OTLP trace payloads and injects upstream authorization', async () => {
  let captured;
  const handler = createHandler(async (url, options) => {
    captured = { url: String(url), options };
    return new Response(null, { status: 200 });
  });
  const response = await invoke(handler, {
    method: 'POST',
    url: '/v1/traces',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer attacker-controlled'
    },
    body: JSON.stringify({ resourceSpans: [] })
  });
  assert.equal(response.status, 202);
  assert.equal(captured.url, 'http://phoenix:6006/v1/traces');
  assert.equal(captured.options.headers.Authorization, 'Bearer dsh0_test-phoenix-ingest-token-000000000000');
  assert.equal(captured.options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(captured.options.body.toString()), { resourceSpans: [] });
});

test('Telemetry gateway rejects unsupported content and oversized bodies before forwarding', async () => {
  let upstreamCalls = 0;
  const handler = createHandler(async () => {
    upstreamCalls += 1;
    return new Response(null, { status: 200 });
  }, { maxBodyBytes: 8 });
  assert.equal((await invoke(handler, {
    method: 'POST', url: '/v1/traces', headers: { 'Content-Type': 'text/plain' }, body: 'trace'
  })).status, 415);
  assert.equal((await invoke(handler, {
    method: 'POST', url: '/v1/traces', headers: {
      'Content-Type': 'application/x-protobuf', 'Content-Encoding': 'gzip'
    }, body: 'compressed'
  })).status, 415);
  assert.equal((await invoke(handler, {
    method: 'POST', url: '/v1/traces', headers: { 'Content-Type': 'application/json' }, body: '0123456789'
  })).status, 413);
  assert.equal(upstreamCalls, 0);
});

test('Telemetry gateway fails closed without a Phoenix ingestion credential', () => {
  assert.throws(
    () => createTelemetryGateway({ upstreamToken: '', fetchImpl: async () => new Response() }),
    /PHOENIX_INGEST_TOKEN/
  );
});
