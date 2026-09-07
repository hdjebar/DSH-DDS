import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';

const ROOT = path.resolve(import.meta.dirname, '..');
const BASE_COMPOSE_PATH = path.join(ROOT, 'docker-compose.yml');
const SANDBOX_COMPOSE_PATH = path.join(ROOT, 'docker-compose.sandbox.yml');
const DEV_COMPOSE_PATH = path.join(ROOT, 'docker-compose.dev.yml');

const overrideTag = {
  tag: '!override',
  collection: 'seq',
  resolve: (value) => value
};

test('Base Compose: immutability, non-root user, and resource limits', () => {
  const raw = fs.readFileSync(BASE_COMPOSE_PATH, 'utf8');
  const compose = yaml.parse(raw);

  const dsh = compose.services.dsh;
  assert.ok(dsh, 'Must define dsh service');
  assert.match(dsh.user, /1000.*1000/, 'dsh must run as UID/GID 1000');
  assert.deepEqual(dsh.security_opt, ['no-new-privileges:true'], 'dsh must enforce no-new-privileges');
  assert.deepEqual(dsh.cap_drop, ['ALL'], 'dsh must drop all Linux capabilities');

  // Resource limits
  assert.ok(dsh.deploy?.resources?.limits, 'dsh must declare resource limits in base compose');
  assert.ok(dsh.deploy.resources.limits.cpus, 'dsh must constrain CPUs');
  assert.ok(dsh.deploy.resources.limits.memory, 'dsh must constrain Memory');

  // Immutability: no development bind mounts in base compose
  const devMounts = dsh.volumes.filter(v => v.includes('packages/dsh-dds-core') || v.includes('entrypoint.sh'));
  assert.equal(
    devMounts.length,
    0,
    `Base compose must not bind-mount live development code; found: ${devMounts.join(', ')}`
  );

  // Loopback only
  for (const port of dsh.ports) {
    assert.match(port, /^127\.0\.0\.1:/, `Port binding must be loopback only: ${port}`);
  }

  // Vault master key variable passed to container
  assert.ok(
    dsh.environment.some(e => e.startsWith('DSH_VAULT_MASTER_KEY=')),
    'Base compose must pass DSH_VAULT_MASTER_KEY to dsh container'
  );

  // Phoenix service
  const phoenix = compose.services.phoenix;
  assert.ok(phoenix, 'Must define phoenix service');
  assert.deepEqual(phoenix.cap_drop, ['ALL'], 'phoenix must drop all capabilities');
  assert.deepEqual(phoenix.security_opt, ['no-new-privileges:true'], 'phoenix must enforce no-new-privileges');
  assert.ok(
    phoenix.healthcheck.test.includes('python3') && !phoenix.healthcheck.test.includes('python3.13'),
    'Phoenix healthcheck must use generic python3 instead of brittle minor version'
  );
});

test('Sandbox Compose: credential blanking, audit retention, named volume state, and hardened egress proxy', () => {
  const raw = fs.readFileSync(SANDBOX_COMPOSE_PATH, 'utf8');
  const compose = yaml.parse(raw, { customTags: [overrideTag] });

  const dsh = compose.services.dsh;
  assert.ok(dsh, 'Must define dsh service in sandbox override');
  assert.equal(dsh.read_only, true, 'dsh must have read_only: true in sandbox');
  assert.deepEqual(dsh.cap_drop, ['ALL'], 'dsh must override cap_drop to ALL');
  assert.deepEqual(dsh.security_opt, ['no-new-privileges:true'], 'dsh must override security_opt to no-new-privileges');

  // Credential blanking
  const env = dsh.environment;
  const sensitiveKeys = [
    'OPENROUTER_API_KEY',
    'GEMINI_API_KEY',
    'GITHUB_PERSONAL_ACCESS_TOKEN',
    'GITHUB_TOKEN',
    'TAVILY_API_KEY',
    'FIRECRAWL_API_KEY',
    'EXA_API_KEY',
    'PHOENIX_API_KEY',
    'PHOENIX_SECRET'
  ];

  for (const key of sensitiveKeys) {
    assert.ok(
      env.some(e => e === `${key}=` || e === key),
      `Sandbox dsh must explicitly blank ${key} to prevent credential theft`
    );
  }

  // Audit preservation
  assert.ok(
    dsh.volumes.some(v => v.includes('/var/lib/dsh/audit')),
    'Sandbox must persist GRC audit logs into ./config/audit'
  );

  // Named volume session isolation
  assert.ok(
    dsh.volumes.some(v => v.includes('sandbox-session-state:/var/lib/dsh-state')),
    'Sandbox must use dedicated sandbox-session-state named volume instead of host session dirs'
  );
  assert.ok(compose.volumes?.['sandbox-session-state'], 'Must define sandbox-session-state named volume');

  // Hardened tmpfs modes
  for (const t of dsh.tmpfs) {
    if (t.startsWith('/tmp:') || t.startsWith('/run:')) {
      assert.ok(t.includes('mode=1777'), `${t} must have mode=1777`);
    } else if (t.startsWith('/var/log/dsh:')) {
      assert.ok(t.includes('mode=0750'), '/var/log/dsh must have mode=0750');
    } else {
      assert.ok(!t.includes('mode=1777'), `Internal tmpfs mount must not be world-writable: ${t}`);
    }
  }

  // Hardened egress-filter sidecar
  const egressFilter = compose.services['egress-filter'];
  assert.ok(egressFilter, 'Must define egress-filter');
  assert.match(
    egressFilter.image,
    /@sha256:[a-f0-9]{64}$/,
    'egress-filter must pin an immutable sha256 image digest'
  );
  assert.deepEqual(egressFilter.cap_drop, ['ALL'], 'egress-filter must drop ALL capabilities');
  assert.deepEqual(egressFilter.security_opt, ['no-new-privileges:true'], 'egress-filter must enforce no-new-privileges');
  assert.ok(egressFilter.deploy?.resources?.limits?.cpus, 'egress-filter must declare CPU limits');
  assert.ok(egressFilter.deploy?.resources?.limits?.memory, 'egress-filter must declare memory limits');
});

test('Developer Compose: live-reload bind mounts isolated to dev override', () => {
  assert.ok(fs.existsSync(DEV_COMPOSE_PATH), 'docker-compose.dev.yml must exist');
  const raw = fs.readFileSync(DEV_COMPOSE_PATH, 'utf8');
  const compose = yaml.parse(raw);

  const dsh = compose.services?.dsh;
  assert.ok(dsh, 'dev compose must define dsh service');
  assert.ok(
    dsh.volumes.some(v => v.includes('packages/dsh-dds-core')),
    'dev compose must mount in-tree packages/dsh-dds-core'
  );
  assert.ok(
    dsh.volumes.some(v => v.includes('docker/entrypoint.sh')),
    'dev compose must mount docker/entrypoint.sh'
  );
});
