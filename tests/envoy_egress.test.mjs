import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';

const ROOT = path.resolve(import.meta.dirname, '..');
const ENVOY_CONFIG_PATH = path.join(ROOT, 'config/network/envoy-egress.yaml');
const COMPOSE_SANDBOX_PATH = path.join(ROOT, 'docker-compose.sandbox.yml');

test('Envoy Egress Configuration: parses valid YAML and configures listener', () => {
  assert.ok(fs.existsSync(ENVOY_CONFIG_PATH), 'envoy-egress.yaml must exist');
  const raw = fs.readFileSync(ENVOY_CONFIG_PATH, 'utf8');
  const config = yaml.parse(raw);

  assert.ok(config.static_resources, 'Must contain static_resources');
  const listeners = config.static_resources.listeners;
  assert.ok(Array.isArray(listeners) && listeners.length > 0, 'Must contain listeners');

  const listener = listeners[0];
  assert.equal(listener.address.socket_address.port_value, 10000, 'Must listen on port 10000');
});

test('Envoy Egress Configuration: Tier 1 trusted domains allowlist and ADR 0007 enforcement', () => {
  const raw = fs.readFileSync(ENVOY_CONFIG_PATH, 'utf8');
  const config = yaml.parse(raw);

  const filterChains = config.static_resources.listeners[0].filter_chains;
  const hcm = filterChains[0].filters.find(f => f.name.includes('http_connection_manager'));
  assert.ok(hcm, 'Must configure HttpConnectionManager');

  const vhosts = hcm.typed_config.route_config.virtual_hosts;
  const trustedApis = vhosts.find(vh => vh.name === 'trusted_apis');
  assert.ok(trustedApis, 'Must configure trusted_apis virtual host');

  const domains = trustedApis.domains;

  // Model endpoints
  assert.ok(domains.includes('generativelanguage.googleapis.com'));
  assert.ok(domains.includes('generativelanguage.googleapis.com:443'));
  assert.ok(domains.includes('openrouter.ai'));
  assert.ok(domains.includes('openrouter.ai:443'));

  // Registries
  assert.ok(domains.includes('api.github.com'));
  assert.ok(domains.includes('github.com'));
  assert.ok(domains.includes('registry.npmjs.org'));
  assert.ok(domains.includes('pypi.org'));

  // ADR 0007 Security Invariant: Absolutely NO Antigravity or Google OAuth domains in trusted_apis
  const forbiddenKeywords = ['antigravity', 'accounts.google.com', 'oauth2.googleapis.com'];
  for (const domain of domains) {
    for (const forbidden of forbiddenKeywords) {
      assert.ok(!domain.includes(forbidden), `ADR 0007 violation: trusted_apis must not whitelist ${domain}`);
    }
  }
});

test('Envoy Egress Configuration: Tier 2 read-only web fetch and 403 mutation block', () => {
  const raw = fs.readFileSync(ENVOY_CONFIG_PATH, 'utf8');
  const config = yaml.parse(raw);

  const filterChains = config.static_resources.listeners[0].filter_chains;
  const hcm = filterChains[0].filters.find(f => f.name.includes('http_connection_manager'));
  const vhosts = hcm.typed_config.route_config.virtual_hosts;

  const publicFetch = vhosts.find(vh => vh.name === 'public_web_fetch');
  assert.ok(publicFetch, 'Must configure public_web_fetch virtual host');
  assert.deepEqual(publicFetch.domains, ['*']);

  const routes = publicFetch.routes;
  assert.ok(routes.length >= 2, 'Must contain allow and block routes');

  // Route 1: Read-only GET/HEAD
  const getHeadRoute = routes[0];
  assert.equal(getHeadRoute.match.prefix, '/');
  const methodHeader = getHeadRoute.match.headers.find(h => h.name === ':method');
  assert.ok(methodHeader, 'Must match :method header');
  assert.equal(methodHeader.string_match.safe_regex.regex, '^(GET|HEAD)$');
  assert.equal(getHeadRoute.route.timeout, '10s', 'Read-only web fetch must have 10s timeout');

  // Route 2: 403 Forbidden for mutation methods
  const blockRoute = routes[1];
  assert.equal(blockRoute.match.prefix, '/');
  assert.equal(blockRoute.direct_response.status, 403);
  assert.ok(
    blockRoute.direct_response.body.inline_string.includes('DSH-DDS Egress Violation'),
    'Must include egress violation explanation in 403 body'
  );
});

test('Sandbox Compose Topology: egress-filter sidecar and dual-network routing', () => {
  const raw = fs.readFileSync(COMPOSE_SANDBOX_PATH, 'utf8');
  const overrideTag = {
    tag: '!override',
    collection: 'seq',
    resolve: (value) => value
  };
  const compose = yaml.parse(raw, { customTags: [overrideTag] });

  assert.ok(compose.services['egress-filter'], 'Must define egress-filter service');
  const egressFilter = compose.services['egress-filter'];
  assert.ok(egressFilter.networks.includes('dsh-internal'), 'egress-filter must attach to dsh-internal');
  assert.ok(egressFilter.networks.includes('dsh-egress-net'), 'egress-filter must attach to dsh-egress-net');

  // dsh container isolation
  const dsh = compose.services.dsh;
  assert.deepEqual(dsh.networks, ['dsh-internal'], 'dsh must strictly connect only to internal network');
  assert.ok(
    dsh.environment.some(e => e.includes('HTTP_PROXY=http://egress-filter:10000')),
    'dsh must route HTTP via egress-filter'
  );
  assert.ok(
    dsh.environment.some(e => e.includes('HTTPS_PROXY=http://egress-filter:10000')),
    'dsh must route HTTPS via egress-filter'
  );

  // Networks definition
  assert.equal(compose.networks['dsh-internal'].internal, true, 'dsh-internal must have internal: true');
  assert.equal(compose.networks['dsh-egress-net'].driver, 'bridge', 'dsh-egress-net must be bridge driver');
});
