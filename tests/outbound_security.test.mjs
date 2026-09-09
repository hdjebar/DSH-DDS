import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OutboundSecurityError,
  readResponseBodyLimited,
  secureFetch,
  validateOutboundUrl
} from '../config/outbound-security.mjs';
import { DeclarativeWorkflowEngine } from '../config/declarative-orchestrator.mjs';

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

test('Outbound security rejects metadata, loopback, private DNS, credentials, and non-allowlisted hosts', async () => {
  const options = { allowedHosts: ['api.example.test'], lookup: publicLookup };
  await assert.rejects(validateOutboundUrl('https://169.254.169.254/latest/meta-data/', {
    allowedHosts: ['169.254.169.254']
  }), (error) => error.code === 'OUTBOUND_ADDRESS_DENIED');
  await assert.rejects(validateOutboundUrl('https://127.0.0.1/', { allowedHosts: ['127.0.0.1'] }),
    (error) => error.code === 'OUTBOUND_ADDRESS_DENIED');
  await assert.rejects(validateOutboundUrl('https://api.example.test/', {
    allowedHosts: ['api.example.test'], lookup: async () => [{ address: '10.0.0.7', family: 4 }]
  }), (error) => error.code === 'OUTBOUND_ADDRESS_DENIED');
  await assert.rejects(validateOutboundUrl('https://user:secret@api.example.test/', options),
    (error) => error.code === 'OUTBOUND_CREDENTIALS_DENIED');
  await assert.rejects(validateOutboundUrl('https://evil.example/', options),
    (error) => error.code === 'OUTBOUND_HOST_DENIED');
  await assert.rejects(validateOutboundUrl('https://api.example.test:8443/', {
    ...options, allowedPorts: [443]
  }), (error) => error.code === 'OUTBOUND_PORT_DENIED');
});

test('Outbound security revalidates redirect destinations', async () => {
  const fetchImpl = async () => new Response(null, {
    status: 302,
    headers: { location: 'http://169.254.169.254/latest/meta-data/' }
  });
  await assert.rejects(secureFetch('https://api.example.test/start', {
    allowedHosts: ['api.example.test'], lookup: publicLookup, fetchImpl
  }), (error) => error instanceof OutboundSecurityError && error.code === 'OUTBOUND_PROTOCOL_DENIED');
});

test('Outbound security bounds streamed and declared response bodies', async () => {
  const declared = new Response('small', { headers: { 'content-length': '1000' } });
  await assert.rejects(readResponseBodyLimited(declared, 10),
    (error) => error.code === 'OUTBOUND_RESPONSE_TOO_LARGE');

  const streamed = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(8));
      controller.enqueue(new Uint8Array(8));
      controller.close();
    }
  }));
  await assert.rejects(readResponseBodyLimited(streamed, 10),
    (error) => error.code === 'OUTBOUND_RESPONSE_TOO_LARGE');
});

test('Declarative outbound adapters fail closed for metadata and arbitrary targets', async () => {
  const engine = new DeclarativeWorkflowEngine({ name: 'network-test' });
  const probe = await engine.actionHandlers.get('probe_services')({ target: 'http://169.254.169.254/latest/meta-data/' }, {});
  assert.equal(probe.status, 'failed');
  assert.equal(probe.code, 'OUTBOUND_HOST_DENIED');
  assert.match(probe.error, /not allowlisted/);

  const verify = await engine.actionHandlers.get('verify_endpoint')({ target: 'http://attacker.example/' }, {});
  assert.equal(verify.status, 'failed');
  assert.equal(verify.code, 'OUTBOUND_HOST_DENIED');
  assert.match(verify.error, /not allowlisted/);

  const sdmx = await engine.actionHandlers.get('fetch_sdmx_dataflows')({ target: 'http://lustat.statec.lu/rest/dataflow' }, {});
  assert.equal(sdmx.status, 'failed');
  assert.equal(sdmx.code, 'OUTBOUND_PROTOCOL_DENIED');
});
