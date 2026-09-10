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

  // Audit integrity: an untrusted workload must NOT hold a writable host bind to the
  // record of its own authorization decisions. In sandbox mode the audit file lives on
  // tmpfs and the durable copy is the OTel export to the phoenix container.
  assert.ok(
    !dsh.volumes.some(v => v.includes('/var/lib/dsh/audit')),
    'Sandbox must NOT bind-mount the host audit directory into the untrusted workload'
  );

  // Named volume session isolation
  assert.ok(
    dsh.volumes.some(v => v.includes('sandbox-session-state:/var/lib/dsh-state')),
    'Sandbox must use dedicated sandbox-session-state named volume instead of host session dirs'
  );
  assert.ok(compose.volumes?.['sandbox-session-state'], 'Must define sandbox-session-state named volume');

  // Hardened tmpfs modes
  for (const t of dsh.tmpfs) {
    if (t.startsWith('/tmp:')) {
      assert.ok(t.includes('mode=1777'), `${t} must have mode=1777`);
    } else if (t.startsWith('/run:')) {
      assert.ok(t.includes('mode=0770'), `${t} must have mode=0770`);
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

test('GRC Audit Durability: a separate writer exclusively owns ledger and checkpoint mounts', () => {
  const compose = yaml.parse(fs.readFileSync(BASE_COMPOSE_PATH, 'utf8'));
  const dsh = compose.services.dsh;
  const writer = compose.services['audit-writer'];
  assert.ok(writer, 'Base compose must define the external audit writer');
  assert.ok(!dsh.volumes.some(value => String(value).includes('/var/lib/dsh/audit')), 'dsh must not mount audit storage');
  assert.ok(!dsh.environment.some(value => String(value).startsWith('DSH_AUDIT_INTEGRITY_KEY=')), 'dsh must not hold the audit integrity key');
  assert.ok(dsh.environment.includes('DSH_AUDIT_WRITER_REQUIRED=1'), 'dsh must fail closed when the writer is unavailable');
  assert.ok(writer.volumes.some(value => String(value).endsWith('/var/lib/dsh/audit:rw')), 'writer must own the ledger mount');
  assert.ok(writer.volumes.some(value => String(value).endsWith('/var/lib/dsh/checkpoints:rw')), 'writer must own the checkpoint mount');
  assert.ok(writer.environment.some(value => String(value).startsWith('DSH_AUDIT_INTEGRITY_KEY=')), 'only the writer receives the audit key');
  assert.ok(!writer.volumes.some(value => String(value).includes('/etc/dsh')), 'writer must not mount the full configuration tree');
  assert.deepEqual(writer.networks, ['audit-internal'], 'writer must use its dedicated internal network');
  assert.ok(dsh.networks.includes('audit-internal'), 'dsh must reach the writer on the dedicated internal network');
  assert.equal(compose.networks['audit-internal'].internal, true);
});

test('GRC Audit Durability: getGrcAuditLogPath honours DSH_AUDIT_LOG_FILE over the internal default', async () => {
  const { getGrcAuditLogPath } = await import('../config/rbac-policy.mjs');
  const prev = process.env.DSH_AUDIT_LOG_FILE;
  try {
    process.env.DSH_AUDIT_LOG_FILE = '/var/lib/dsh/audit/audit_grc.jsonl';
    assert.equal(getGrcAuditLogPath(), '/var/lib/dsh/audit/audit_grc.jsonl');
  } finally {
    if (prev === undefined) delete process.env.DSH_AUDIT_LOG_FILE;
    else process.env.DSH_AUDIT_LOG_FILE = prev;
  }
});

test('Phoenix authentication and management-plane isolation are enabled by default', () => {
  const compose = yaml.parse(fs.readFileSync(BASE_COMPOSE_PATH, 'utf8'));
  const dsh = compose.services.dsh;
  const phoenix = compose.services.phoenix;
  const gateway = compose.services['telemetry-gateway'];

  assert.ok(phoenix.environment.includes('PHOENIX_ENABLE_AUTH=true'));
  assert.ok(phoenix.environment.some(value => String(value).startsWith('PHOENIX_ADMIN_SECRET=')));
  assert.ok(!dsh.environment.some(value => String(value).startsWith('PHOENIX_SECRET=')));
  assert.ok(!dsh.environment.some(value => String(value).startsWith('PHOENIX_API_KEY=')));
  assert.deepEqual(dsh.networks, ['dsh-runtime', 'audit-internal']);
  assert.deepEqual(phoenix.networks, ['phoenix-internal']);
  assert.ok(gateway.networks.includes('dsh-runtime'));
  assert.ok(gateway.networks.includes('phoenix-internal'));
  assert.ok(gateway.environment.some(value => String(value).includes('PHOENIX_INGEST_TOKEN=')));
  assert.ok(!gateway.volumes, 'telemetry gateway must use immutable image code without the full config mount');
  assert.equal(compose.networks['phoenix-internal'].internal, true);
  assert.ok(dsh.environment.includes('DSH_TELEMETRY_OTLP_URL=http://telemetry-gateway:4318/v1/traces'));
});
