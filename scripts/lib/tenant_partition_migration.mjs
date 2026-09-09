import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { deriveUserPartitionId } from '../../packages/dsh-dds-core/iam.js';

export const INVENTORY_SCHEMA = 'dsh.tenant-partition-inventory/v1';
export const MANIFEST_SCHEMA = 'dsh.tenant-partition-migration/v1';
export const JOURNAL_SCHEMA = 'dsh.tenant-partition-migration-journal/v1';

const LEGACY_ID = /^[a-z0-9_-]+$/;
const U2_ID = /^u2_[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digestDocument(document) {
  const unsigned = { ...document };
  delete unsigned.integrity;
  return `sha256:${crypto.createHash('sha256').update(canonical(unsigned)).digest('hex')}`;
}

function assertDocumentIntegrity(document, schema) {
  if (!document || document.schema !== schema || typeof document.integrity !== 'string') {
    throw new Error(`Expected a signed ${schema} document`);
  }
  if ([MANIFEST_SCHEMA, JOURNAL_SCHEMA].includes(schema)) assertMigrationId(document.migrationId);
  if (digestDocument(document) !== document.integrity) {
    throw new Error(`${schema} integrity check failed`);
  }
}

function signDocument(document) {
  const signed = { ...document };
  signed.integrity = digestDocument(signed);
  return signed;
}

function assertPartitionId(value, kind = 'legacy') {
  const pattern = kind === 'u2' ? U2_ID : LEGACY_ID;
  if (typeof value !== 'string' || !pattern.test(value) || value === '.' || value === '..') {
    throw new Error(`Invalid ${kind} partition ID`);
  }
  if (kind === 'legacy' && U2_ID.test(value)) throw new Error('A u2 partition is not a legacy partition');
  return value;
}

function assertMigrationId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('Migration ID must be a UUID');
  return value;
}

function assertPlainDirectory(root, label) {
  const resolved = path.resolve(root);
  if (!fs.existsSync(resolved)) return resolved;
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${label} must be a real directory, not a symlink`);
  return fs.realpathSync(resolved);
}

function childPath(root, partitionId, kind = 'legacy') {
  assertPartitionId(partitionId, kind);
  const candidate = path.resolve(root, partitionId);
  const relative = path.relative(path.resolve(root), candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Partition path escapes its configured root');
  }
  return candidate;
}

function inspectTree(root) {
  const hash = crypto.createHash('sha256');
  let files = 0;
  let directories = 0;
  let bytes = 0;

  function visit(current, relative) {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`Symlinks are forbidden in migration sources (${relative || '.'})`);
    if (stat.isDirectory()) {
      directories += 1;
      hash.update(`d\0${relative}\0${stat.mode & 0o7777}\0`);
      for (const name of fs.readdirSync(current).sort()) visit(path.join(current, name), path.join(relative, name));
      return;
    }
    if (!stat.isFile()) throw new Error(`Unsupported filesystem object in migration source (${relative})`);
    files += 1;
    bytes += stat.size;
    hash.update(`f\0${relative}\0${stat.mode & 0o7777}\0${stat.size}\0`);
    const descriptor = fs.openSync(current, 'r');
    try {
      const buffer = Buffer.allocUnsafe(64 * 1024);
      for (;;) {
        const read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
        if (!read) break;
        hash.update(buffer.subarray(0, read));
      }
    } finally {
      fs.closeSync(descriptor);
    }
  }

  visit(root, '');
  return { fingerprint: `sha256:${hash.digest('hex')}`, files, directories, bytes };
}

function inventoryRoot(root, kind) {
  const legacy = new Map();
  const existingV2 = [];
  const unmanaged = [];
  if (!fs.existsSync(root)) return { legacy, existingV2, unmanaged };
  for (const name of fs.readdirSync(root).sort()) {
    if (name === '.dsh-migration-backups' || name === '.dsh-migration-lock') continue;
    const candidate = path.join(root, name);
    const stat = fs.lstatSync(candidate);
    if (U2_ID.test(name)) {
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${kind} u2 partition '${name}' is not a real directory`);
      existingV2.push(name);
    } else if (LEGACY_ID.test(name) && name !== '.' && name !== '..') {
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${kind} legacy partition '${name}' is not a real directory`);
      legacy.set(name, inspectTree(candidate));
    } else {
      unmanaged.push(name);
    }
  }
  return { legacy, existingV2, unmanaged };
}

export function inventoryTenantPartitions({ stateRoot, workspaceRoot, now = new Date() }) {
  const state = assertPlainDirectory(stateRoot, 'State root');
  const workspace = assertPlainDirectory(workspaceRoot, 'Workspace users root');
  const relation = path.relative(state, workspace);
  const reverseRelation = path.relative(workspace, state);
  if (!relation || (!relation.startsWith('..') && !path.isAbsolute(relation))
    || (!reverseRelation.startsWith('..') && !path.isAbsolute(reverseRelation))) {
    throw new Error('State and workspace roots must be separate, non-nested directories');
  }
  const stateInventory = inventoryRoot(state, 'state');
  const workspaceInventory = inventoryRoot(workspace, 'workspace');
  const legacyIds = [...new Set([...stateInventory.legacy.keys(), ...workspaceInventory.legacy.keys()])].sort();
  const partitions = legacyIds.map(legacyPartitionId => ({
    legacyPartitionId,
    resources: [
      stateInventory.legacy.has(legacyPartitionId)
        ? { kind: 'state', ...stateInventory.legacy.get(legacyPartitionId) }
        : null,
      workspaceInventory.legacy.has(legacyPartitionId)
        ? { kind: 'workspace', ...workspaceInventory.legacy.get(legacyPartitionId) }
        : null
    ].filter(Boolean)
  }));
  return signDocument({
    schema: INVENTORY_SCHEMA,
    createdAt: now.toISOString(),
    roots: { state, workspace },
    partitions,
    existingV2: {
      state: stateInventory.existingV2,
      workspace: workspaceInventory.existingV2
    },
    unmanagedEntries: {
      state: stateInventory.unmanaged,
      workspace: workspaceInventory.unmanaged
    }
  });
}

function validateIdentityRecord(record) {
  if (!record || typeof record !== 'object') throw new Error('Identity adjudication records must be objects');
  for (const field of ['issuer', 'subject', 'legacyPartitionId', 'decision']) {
    if (typeof record[field] !== 'string' || !record[field].trim()) throw new Error(`Identity record requires '${field}'`);
  }
  assertPartitionId(record.legacyPartitionId);
  if (!['migrate', 'skip'].includes(record.decision)) throw new Error("Identity decision must be 'migrate' or 'skip'");
  if (record.decision === 'migrate' && (typeof record.ownershipEvidence !== 'string' || !record.ownershipEvidence.trim())) {
    throw new Error(`Migration of '${record.legacyPartitionId}' requires ownershipEvidence`);
  }
  if (record.decision === 'skip' && (typeof record.adjudicationReason !== 'string' || !record.adjudicationReason.trim())) {
    throw new Error(`Skipped identity '${record.legacyPartitionId}' requires adjudicationReason`);
  }
  return {
    issuer: record.issuer.trim(),
    subject: record.subject.trim(),
    legacyPartitionId: record.legacyPartitionId,
    decision: record.decision,
    ...(record.ownershipEvidence ? { ownershipEvidence: record.ownershipEvidence.trim() } : {}),
    ...(record.adjudicationReason ? { adjudicationReason: record.adjudicationReason.trim() } : {})
  };
}

export function planTenantPartitionMigration({ inventory, identities, now = new Date(), migrationId = crypto.randomUUID() }) {
  assertDocumentIntegrity(inventory, INVENTORY_SCHEMA);
  assertMigrationId(migrationId);
  if (!Array.isArray(identities) || identities.length === 0) throw new Error('At least one adjudicated identity is required');
  const records = identities.map(validateIdentityRecord);
  const inventoryByLegacy = new Map(inventory.partitions.map(item => [item.legacyPartitionId, item]));
  const recordsByLegacy = new Map();
  for (const record of records) {
    if (!inventoryByLegacy.has(record.legacyPartitionId)) {
      throw new Error(`Identity references non-inventoried legacy partition '${record.legacyPartitionId}'`);
    }
    const group = recordsByLegacy.get(record.legacyPartitionId) || [];
    group.push(record);
    recordsByLegacy.set(record.legacyPartitionId, group);
  }
  for (const legacyId of inventoryByLegacy.keys()) {
    if (!recordsByLegacy.has(legacyId)) throw new Error(`Legacy partition '${legacyId}' has no explicit adjudication`);
  }

  const entries = [];
  const skipped = [];
  const destinations = new Set();
  const existing = new Set([...inventory.existingV2.state, ...inventory.existingV2.workspace]);
  for (const [legacyPartitionId, group] of [...recordsByLegacy.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const migrating = group.filter(record => record.decision === 'migrate');
    if (migrating.length !== 1) {
      throw new Error(`Legacy partition '${legacyPartitionId}' must have exactly one explicitly selected owner`);
    }
    if (group.length > 1 && group.filter(record => record !== migrating[0])
      .some(record => record.decision !== 'skip' || !record.adjudicationReason)) {
      throw new Error(`Collision for '${legacyPartitionId}' has not been explicitly adjudicated`);
    }
    const owner = migrating[0];
    const destinationPartitionId = deriveUserPartitionId(owner.subject, owner.issuer);
    if (destinations.has(destinationPartitionId)) throw new Error(`Multiple legacy partitions target '${destinationPartitionId}'`);
    if (existing.has(destinationPartitionId)) throw new Error(`Destination partition '${destinationPartitionId}' already exists`);
    destinations.add(destinationPartitionId);
    const source = inventoryByLegacy.get(legacyPartitionId);
    entries.push({
      legacyPartitionId,
      destinationPartitionId,
      identity: { issuer: owner.issuer, subject: owner.subject },
      ownershipEvidence: owner.ownershipEvidence,
      resources: source.resources
    });
    for (const record of group.filter(item => item.decision === 'skip')) {
      skipped.push({
        legacyPartitionId,
        identity: { issuer: record.issuer, subject: record.subject },
        adjudicationReason: record.adjudicationReason
      });
    }
  }
  return signDocument({
    schema: MANIFEST_SCHEMA,
    migrationId,
    createdAt: now.toISOString(),
    sourceInventoryIntegrity: inventory.integrity,
    roots: inventory.roots,
    entries,
    skipped
  });
}

function resourcePaths(manifest, entry, resource) {
  if (!['state', 'workspace'].includes(resource.kind)) throw new Error('Unknown migration resource kind');
  const root = assertPlainDirectory(manifest.roots[resource.kind], `${resource.kind} root`);
  if (root !== manifest.roots[resource.kind]) throw new Error(`${resource.kind} root canonical path has changed`);
  assertMigrationId(manifest.migrationId);
  const source = childPath(root, entry.legacyPartitionId);
  const destination = childPath(root, entry.destinationPartitionId, 'u2');
  const backupRoot = path.resolve(root, '.dsh-migration-backups');
  const backupBase = path.resolve(backupRoot, manifest.migrationId);
  const backup = path.resolve(backupBase, entry.legacyPartitionId);
  assertBackupContainment(root, backupRoot, backupBase, backup);
  return { root, source, destination, backupBase, backup };
}

function assertBackupContainment(root, ...paths) {
  const canonicalRoot = path.resolve(root);
  for (const candidate of paths) {
    const relative = path.relative(canonicalRoot, candidate);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Migration backup path escapes its configured root');
    }
    let current = canonicalRoot;
    for (const component of relative.split(path.sep)) {
      current = path.join(current, component);
      if (!fs.existsSync(current)) break;
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) throw new Error('Migration backup path must not contain symlinks');
      if (current !== candidate && !stat.isDirectory()) {
        throw new Error('Migration backup path parent must be a directory');
      }
    }
  }
}

function validateResourceState(manifest, entry, resource, expected = 'source') {
  const paths = resourcePaths(manifest, entry, resource);
  const selected = expected === 'source' ? paths.source : paths.destination;
  if (!fs.existsSync(selected)) throw new Error(`Expected ${resource.kind} ${expected} partition is missing`);
  const actual = inspectTree(selected);
  if (actual.fingerprint !== resource.fingerprint || actual.files !== resource.files || actual.bytes !== resource.bytes) {
    throw new Error(`${resource.kind} partition changed since inventory`);
  }
  return { ...paths, actual };
}

function atomicWriteJson(filename, document) {
  const resolved = path.resolve(filename);
  fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  const temporary = `${resolved}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  fs.writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, resolved);
}

function acquireLocks(manifest, selectedRoots = Object.values(manifest.roots)) {
  const locks = [];
  try {
    for (const root of [...new Set(selectedRoots)].sort()) {
      const lock = path.join(root, '.dsh-migration-lock');
      const descriptor = fs.openSync(lock, 'wx', 0o600);
      fs.writeFileSync(descriptor, `${manifest.migrationId}\n`, 'utf8');
      locks.push({ lock, descriptor });
    }
    return locks;
  } catch (error) {
    releaseLocks(locks);
    throw new Error(`Could not acquire migration lock: ${error.message}`);
  }
}

function releaseLocks(locks) {
  for (const item of locks.reverse()) {
    try { fs.closeSync(item.descriptor); } catch {}
    try { fs.unlinkSync(item.lock); } catch {}
  }
}

function createJournal(manifest, now) {
  return signDocument({
    schema: JOURNAL_SCHEMA,
    migrationId: manifest.migrationId,
    manifestIntegrity: manifest.integrity,
    createdAt: now.toISOString(),
    status: 'applying',
    operations: []
  });
}

export function applyTenantPartitionMigration({ manifest, journalPath, execute = false, now = new Date() }) {
  assertDocumentIntegrity(manifest, MANIFEST_SCHEMA);
  if (execute && journalPath && fs.existsSync(journalPath)) {
    const prior = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
    assertDocumentIntegrity(prior, JOURNAL_SCHEMA);
    if (prior.manifestIntegrity !== manifest.integrity) throw new Error('Journal belongs to a different manifest');
    if (prior.status === 'applied') return verifyTenantPartitionMigration({ manifest, journal: prior });
    throw new Error(`Existing journal is in '${prior.status}' state`);
  }
  const checks = [];
  for (const entry of manifest.entries) {
    for (const resource of entry.resources) {
      const state = validateResourceState(manifest, entry, resource, 'source');
      if (fs.existsSync(state.destination)) throw new Error(`Destination already exists for ${entry.destinationPartitionId}`);
      if (fs.existsSync(state.backup)) throw new Error(`Backup already exists for ${entry.legacyPartitionId}`);
      checks.push({ entry, resource, ...state });
    }
  }
  if (!execute) {
    return { dryRun: true, migrationId: manifest.migrationId, operations: checks.map(item => ({
      kind: item.resource.kind,
      legacyPartitionId: item.entry.legacyPartitionId,
      destinationPartitionId: item.entry.destinationPartitionId,
      files: item.resource.files,
      bytes: item.resource.bytes
    })) };
  }
  if (!journalPath) throw new Error('An explicit journalPath is required for apply');
  const locks = acquireLocks(manifest, checks.map(item => item.root));
  let journal = createJournal(manifest, now);
  atomicWriteJson(journalPath, journal);
  const moved = [];
  try {
    for (const item of checks) {
      fs.mkdirSync(item.backupBase, { recursive: true, mode: 0o700 });
      assertBackupContainment(item.root, item.backupBase, item.backup);
      fs.cpSync(item.source, item.backup, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
      const backupInspection = inspectTree(item.backup);
      if (backupInspection.fingerprint !== item.resource.fingerprint) throw new Error('Backup verification failed');
      const sourceInspection = inspectTree(item.source);
      if (sourceInspection.fingerprint !== item.resource.fingerprint) throw new Error('Source changed while backup was created');
      fs.renameSync(item.source, item.destination);
      moved.push(item);
      journal.operations.push({
        kind: item.resource.kind,
        legacyPartitionId: item.entry.legacyPartitionId,
        destinationPartitionId: item.entry.destinationPartitionId,
        fingerprint: item.resource.fingerprint,
        status: 'moved'
      });
      journal = signDocument({ ...journal, integrity: undefined, operations: journal.operations });
      atomicWriteJson(journalPath, journal);
    }
    journal = signDocument({ ...journal, integrity: undefined, status: 'applied', completedAt: now.toISOString() });
    atomicWriteJson(journalPath, journal);
    return verifyTenantPartitionMigration({ manifest, journal });
  } catch (error) {
    for (const item of moved.reverse()) {
      try {
        if (!fs.existsSync(item.source) && fs.existsSync(item.destination)) fs.renameSync(item.destination, item.source);
      } catch {}
    }
    journal = signDocument({ ...journal, integrity: undefined, status: 'failed', failedAt: now.toISOString(), error: error.message });
    atomicWriteJson(journalPath, journal);
    throw error;
  } finally {
    releaseLocks(locks);
  }
}

export function verifyTenantPartitionMigration({ manifest, journal }) {
  assertDocumentIntegrity(manifest, MANIFEST_SCHEMA);
  assertDocumentIntegrity(journal, JOURNAL_SCHEMA);
  if (journal.manifestIntegrity !== manifest.integrity || journal.migrationId !== manifest.migrationId) {
    throw new Error('Manifest and journal do not match');
  }
  const expected = journal.status === 'rolled_back' ? 'source' : 'destination';
  if (!['applied', 'rolled_back'].includes(journal.status)) throw new Error(`Cannot verify journal in '${journal.status}' state`);
  const resources = [];
  for (const entry of manifest.entries) {
    for (const resource of entry.resources) {
      const state = validateResourceState(manifest, entry, resource, expected);
      const absent = expected === 'source' ? state.destination : state.source;
      if (fs.existsSync(absent)) throw new Error(`Both source and destination exist for '${entry.legacyPartitionId}'`);
      resources.push({ kind: resource.kind, legacyPartitionId: entry.legacyPartitionId, status: expected });
    }
  }
  return { verified: true, migrationId: manifest.migrationId, status: journal.status, resources };
}

export function rollbackTenantPartitionMigration({
  manifest,
  journal,
  journalPath,
  execute = false,
  now = new Date(),
  rename = fs.renameSync
}) {
  assertDocumentIntegrity(manifest, MANIFEST_SCHEMA);
  assertDocumentIntegrity(journal, JOURNAL_SCHEMA);
  if (journal.status === 'rolled_back') return verifyTenantPartitionMigration({ manifest, journal });
  if (!['applied', 'rolling_back', 'rollback_failed'].includes(journal.status)) {
    throw new Error(`Only an applied or interrupted rollback can be rolled back (found '${journal.status}')`);
  }
  if (journal.manifestIntegrity !== manifest.integrity) throw new Error('Journal belongs to a different manifest');
  const checks = [];
  for (const entry of manifest.entries) {
    for (const resource of entry.resources) {
      const paths = resourcePaths(manifest, entry, resource);
      const sourceExists = fs.existsSync(paths.source);
      const destinationExists = fs.existsSync(paths.destination);
      if (sourceExists === destinationExists) {
        throw new Error(`Expected exactly one source or destination for '${entry.legacyPartitionId}'`);
      }
      const expected = sourceExists ? 'source' : 'destination';
      const state = validateResourceState(manifest, entry, resource, expected);
      if (!fs.existsSync(state.backup) || inspectTree(state.backup).fingerprint !== resource.fingerprint) {
        throw new Error(`Verified backup is missing for '${entry.legacyPartitionId}'`);
      }
      checks.push({ entry, resource, rollbackState: sourceExists ? 'restored' : 'pending', ...state });
    }
  }
  if (!execute) {
    return {
      dryRun: true,
      migrationId: manifest.migrationId,
      operations: checks.length,
      pending: checks.filter(item => item.rollbackState === 'pending').length,
      restored: checks.filter(item => item.rollbackState === 'restored').length
    };
  }
  if (!journalPath) throw new Error('An explicit journalPath is required for rollback');
  const locks = acquireLocks(manifest, checks.map(item => item.root));
  const journalWithoutRollbackFailure = { ...journal };
  delete journalWithoutRollbackFailure.rollbackError;
  delete journalWithoutRollbackFailure.rollbackFailedAt;
  let updated = signDocument({
    ...journalWithoutRollbackFailure,
    integrity: undefined,
    status: 'rolling_back',
    rollbackStartedAt: journal.rollbackStartedAt || now.toISOString()
  });
  atomicWriteJson(journalPath, updated);
  try {
    for (const item of checks.slice().reverse()) {
      if (item.rollbackState === 'restored') continue;
      rename(item.destination, item.source);
      updated = signDocument({
        ...updated,
        integrity: undefined,
        operations: updated.operations.map(operation => (
          operation.kind === item.resource.kind
            && operation.legacyPartitionId === item.entry.legacyPartitionId
            && operation.destinationPartitionId === item.entry.destinationPartitionId
            ? { ...operation, status: 'restored' }
            : operation
        ))
      });
      atomicWriteJson(journalPath, updated);
    }
    updated = signDocument({ ...updated, integrity: undefined, status: 'rolled_back', rolledBackAt: now.toISOString() });
    atomicWriteJson(journalPath, updated);
    return verifyTenantPartitionMigration({ manifest, journal: updated });
  } catch (error) {
    updated = signDocument({
      ...updated,
      integrity: undefined,
      status: 'rollback_failed',
      rollbackFailedAt: now.toISOString(),
      rollbackError: error.message
    });
    atomicWriteJson(journalPath, updated);
    throw error;
  } finally {
    releaseLocks(locks);
  }
}

export function readJsonDocument(filename) {
  return JSON.parse(fs.readFileSync(path.resolve(filename), 'utf8'));
}

export function writeJsonDocument(filename, document) {
  if (fs.existsSync(path.resolve(filename))) throw new Error(`Refusing to overwrite existing document '${path.resolve(filename)}'`);
  atomicWriteJson(filename, document);
}
