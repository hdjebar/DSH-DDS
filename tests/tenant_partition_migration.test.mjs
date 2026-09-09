import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { deriveUserPartitionId } from '../packages/dsh-dds-core/iam.js';
import {
  applyTenantPartitionMigration,
  inventoryTenantPartitions,
  planTenantPartitionMigration,
  readJsonDocument,
  rollbackTenantPartitionMigration,
  verifyTenantPartitionMigration
} from '../scripts/lib/tenant_partition_migration.mjs';
import { runCli } from '../scripts/migrate_tenant_partitions.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-tenant-migration-'));
  const state = path.join(root, 'state');
  const workspace = path.join(root, 'workspace-users');
  fs.mkdirSync(path.join(state, 'alice_example_com', 'storages'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'alice_example_com', 'project'), { recursive: true });
  fs.writeFileSync(path.join(state, 'alice_example_com', 'storages', 'vault.enc.json'), '{"ciphertext":"not-logged"}\n', { mode: 0o600 });
  fs.writeFileSync(path.join(workspace, 'alice_example_com', 'project', 'analysis.txt'), 'tenant material\n');
  return { root, state, workspace };
}

function planFor(fx, identities = [{
  issuer: 'https://idp.example/prod',
  subject: 'alice@example.com',
  legacyPartitionId: 'alice_example_com',
  decision: 'migrate',
  ownershipEvidence: 'IAM-42'
}]) {
  const inventory = inventoryTenantPartitions({
    stateRoot: fx.state,
    workspaceRoot: fx.workspace,
    now: new Date('2026-09-10T00:00:00Z')
  });
  return planTenantPartitionMigration({
    inventory,
    identities,
    now: new Date('2026-09-10T00:01:00Z'),
    migrationId: 'd37baa9c-7f3e-45a7-b53a-250c8123d117'
  });
}

test('tenant migration inventory fingerprints resources without exposing nested names or contents', t => {
  const fx = fixture();
  t.after(() => fs.rmSync(fx.root, { recursive: true, force: true }));
  const inventory = inventoryTenantPartitions({ stateRoot: fx.state, workspaceRoot: fx.workspace });
  assert.equal(inventory.partitions.length, 1);
  assert.equal(inventory.partitions[0].legacyPartitionId, 'alice_example_com');
  assert.deepEqual(inventory.partitions[0].resources.map(resource => resource.kind), ['state', 'workspace']);
  assert.match(inventory.integrity, /^sha256:[a-f0-9]{64}$/);
  const serialized = JSON.stringify(inventory);
  assert.doesNotMatch(serialized, /vault\.enc|analysis\.txt|not-logged|tenant material/);
});

test('tenant migration planner requires explicit collision adjudication and evidence', t => {
  const fx = fixture();
  t.after(() => fs.rmSync(fx.root, { recursive: true, force: true }));
  const inventory = inventoryTenantPartitions({ stateRoot: fx.state, workspaceRoot: fx.workspace });
  assert.throws(() => planTenantPartitionMigration({
    inventory,
    identities: [{
      issuer: 'idp', subject: 'alice@example.com', legacyPartitionId: 'alice_example_com', decision: 'migrate', ownershipEvidence: 'A'
    }],
    migrationId: '../../escape'
  }), /must be a UUID/);
  assert.throws(() => planTenantPartitionMigration({
    inventory,
    identities: [{
      issuer: 'idp', subject: 'alice@example.com', legacyPartitionId: 'alice_example_com', decision: 'migrate'
    }]
  }), /ownershipEvidence/);
  assert.throws(() => planTenantPartitionMigration({
    inventory,
    identities: [
      { issuer: 'idp', subject: 'alice@example.com', legacyPartitionId: 'alice_example_com', decision: 'migrate', ownershipEvidence: 'A' },
      { issuer: 'idp', subject: 'alice+example.com', legacyPartitionId: 'alice_example_com', decision: 'migrate', ownershipEvidence: 'B' }
    ]
  }), /exactly one/);
  const plan = planTenantPartitionMigration({
    inventory,
    identities: [
      { issuer: 'idp', subject: 'alice@example.com', legacyPartitionId: 'alice_example_com', decision: 'migrate', ownershipEvidence: 'A' },
      { issuer: 'idp', subject: 'alice+example.com', legacyPartitionId: 'alice_example_com', decision: 'skip', adjudicationReason: 'IAM owner review selected the other subject' }
    ]
  });
  assert.equal(plan.entries.length, 1);
  assert.equal(plan.skipped.length, 1);
  assert.equal(plan.entries[0].destinationPartitionId, deriveUserPartitionId('alice@example.com', 'idp'));
});

test('tenant migration apply is dry-run-first, atomic, verifiable, idempotent, and reversible', t => {
  const fx = fixture();
  t.after(() => fs.rmSync(fx.root, { recursive: true, force: true }));
  const manifest = planFor(fx);
  const journalPath = path.join(fx.root, 'migration.journal.json');
  const destination = manifest.entries[0].destinationPartitionId;

  const dryRun = applyTenantPartitionMigration({ manifest, journalPath });
  assert.equal(dryRun.dryRun, true);
  assert.equal(fs.existsSync(path.join(fx.state, 'alice_example_com')), true);
  assert.equal(fs.existsSync(journalPath), false);

  const applied = applyTenantPartitionMigration({ manifest, journalPath, execute: true });
  assert.equal(applied.status, 'applied');
  assert.equal(fs.existsSync(path.join(fx.state, 'alice_example_com')), false);
  assert.equal(fs.existsSync(path.join(fx.state, destination, 'storages', 'vault.enc.json')), true);
  assert.equal(fs.existsSync(path.join(fx.workspace, destination, 'project', 'analysis.txt')), true);
  assert.equal(fs.existsSync(path.join(fx.state, '.dsh-migration-backups', manifest.migrationId, 'alice_example_com')), true);

  const journal = readJsonDocument(journalPath);
  assert.equal(verifyTenantPartitionMigration({ manifest, journal }).verified, true);
  assert.equal(applyTenantPartitionMigration({ manifest, journalPath, execute: true }).verified, true);

  const rollbackDryRun = rollbackTenantPartitionMigration({ manifest, journal, journalPath });
  assert.equal(rollbackDryRun.dryRun, true);
  const rolledBack = rollbackTenantPartitionMigration({ manifest, journal, journalPath, execute: true });
  assert.equal(rolledBack.status, 'rolled_back');
  assert.equal(fs.existsSync(path.join(fx.state, 'alice_example_com', 'storages', 'vault.enc.json')), true);
  assert.equal(fs.existsSync(path.join(fx.state, destination)), false);
});

test('tenant migration refuses symlinks, stale inventory, plan tampering, and destructive rollback', t => {
  const symlinkFixture = fixture();
  t.after(() => fs.rmSync(symlinkFixture.root, { recursive: true, force: true }));
  fs.symlinkSync('/tmp', path.join(symlinkFixture.state, 'alice_example_com', 'escape'));
  assert.throws(() => inventoryTenantPartitions({
    stateRoot: symlinkFixture.state,
    workspaceRoot: symlinkFixture.workspace
  }), /Symlinks are forbidden/);

  const fx = fixture();
  t.after(() => fs.rmSync(fx.root, { recursive: true, force: true }));
  const manifest = planFor(fx);
  const journalPath = path.join(fx.root, 'migration.journal.json');
  fs.appendFileSync(path.join(fx.workspace, 'alice_example_com', 'project', 'analysis.txt'), 'changed\n');
  assert.throws(() => applyTenantPartitionMigration({ manifest, journalPath }), /changed since inventory/);

  const clean = fixture();
  t.after(() => fs.rmSync(clean.root, { recursive: true, force: true }));
  const cleanManifest = planFor(clean);
  const tampered = structuredClone(cleanManifest);
  tampered.entries[0].identity.subject = 'mallory';
  assert.throws(() => applyTenantPartitionMigration({ manifest: tampered, journalPath: path.join(clean.root, 'bad.json') }), /integrity check failed/);

  const cleanJournalPath = path.join(clean.root, 'migration.journal.json');
  applyTenantPartitionMigration({ manifest: cleanManifest, journalPath: cleanJournalPath, execute: true });
  const destination = cleanManifest.entries[0].destinationPartitionId;
  fs.appendFileSync(path.join(clean.workspace, destination, 'project', 'analysis.txt'), 'post-migration write\n');
  assert.throws(() => rollbackTenantPartitionMigration({
    manifest: cleanManifest,
    journal: readJsonDocument(cleanJournalPath),
    journalPath: cleanJournalPath,
    execute: true
  }), /changed since inventory/);
});

test('tenant migration rejects symlinked backup containment', t => {
  const fx = fixture();
  t.after(() => fs.rmSync(fx.root, { recursive: true, force: true }));
  const outside = path.join(fx.root, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(fx.state, '.dsh-migration-backups'));
  const manifest = planFor(fx);
  assert.throws(() => applyTenantPartitionMigration({
    manifest,
    journalPath: path.join(fx.root, 'migration.journal.json'),
    execute: true
  }), /backup path must not contain symlinks/);
  assert.equal(fs.readdirSync(outside).length, 0);
});

test('tenant migration persists partial rollback and safely resumes it', t => {
  const fx = fixture();
  t.after(() => fs.rmSync(fx.root, { recursive: true, force: true }));
  const manifest = planFor(fx);
  const journalPath = path.join(fx.root, 'migration.journal.json');
  applyTenantPartitionMigration({ manifest, journalPath, execute: true });

  let renameCalls = 0;
  const interruptedRename = (source, destination) => {
    renameCalls += 1;
    if (renameCalls === 2) {
      throw new Error('injected rollback interruption');
    }
    return fs.renameSync(source, destination);
  };
  assert.throws(() => rollbackTenantPartitionMigration({
    manifest,
    journal: readJsonDocument(journalPath),
    journalPath,
    execute: true,
    rename: interruptedRename
  }), /injected rollback interruption/);

  const interrupted = readJsonDocument(journalPath);
  assert.equal(interrupted.status, 'rollback_failed');
  assert.equal(fs.existsSync(path.join(fx.workspace, 'alice_example_com')), true);
  assert.equal(fs.existsSync(path.join(fx.state, manifest.entries[0].destinationPartitionId)), true);
  const dryRun = rollbackTenantPartitionMigration({ manifest, journal: interrupted, journalPath });
  assert.deepEqual({ pending: dryRun.pending, restored: dryRun.restored }, { pending: 1, restored: 1 });

  const resumed = rollbackTenantPartitionMigration({
    manifest,
    journal: interrupted,
    journalPath,
    execute: true
  });
  assert.equal(resumed.status, 'rolled_back');
  assert.equal(resumed.verified, true);
  const persisted = readJsonDocument(journalPath);
  assert.equal(verifyTenantPartitionMigration({ manifest, journal: persisted }).verified, true);
  assert.equal('rollbackError' in persisted, false);
  assert.equal('rollbackFailedAt' in persisted, false);
});

test('tenant migration CLI performs inventory and plan without mutating tenant directories', t => {
  const fx = fixture();
  t.after(() => fs.rmSync(fx.root, { recursive: true, force: true }));
  const inventoryPath = path.join(fx.root, 'inventory.json');
  const identitiesPath = path.join(fx.root, 'identities.json');
  const manifestPath = path.join(fx.root, 'manifest.json');
  fs.writeFileSync(identitiesPath, JSON.stringify({
    schema: 'dsh.tenant-identities/v1',
    identities: [{
      issuer: 'idp', subject: 'alice', legacyPartitionId: 'alice_example_com', decision: 'migrate', ownershipEvidence: 'ticket-1'
    }]
  }), { mode: 0o600 });
  assert.equal(runCli(['inventory', '--state-root', fx.state, '--workspace-users-root', fx.workspace, '--output', inventoryPath]).partitions, 1);
  assert.equal(runCli(['plan', '--inventory', inventoryPath, '--identities', identitiesPath, '--output', manifestPath]).entries, 1);
  assert.equal(fs.existsSync(path.join(fx.state, 'alice_example_com')), true);
  assert.equal(readJsonDocument(manifestPath).schema, 'dsh.tenant-partition-migration/v1');
});
