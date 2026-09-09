#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyTenantPartitionMigration,
  inventoryTenantPartitions,
  planTenantPartitionMigration,
  readJsonDocument,
  rollbackTenantPartitionMigration,
  verifyTenantPartitionMigration,
  writeJsonDocument
} from './lib/tenant_partition_migration.mjs';

function usage() {
  return `Usage:
  migrate_tenant_partitions.mjs inventory --state-root PATH --workspace-users-root PATH --output FILE
  migrate_tenant_partitions.mjs plan --inventory FILE --identities FILE --output FILE
  migrate_tenant_partitions.mjs apply --manifest FILE --journal FILE [--execute]
  migrate_tenant_partitions.mjs verify --manifest FILE --journal FILE
  migrate_tenant_partitions.mjs rollback --manifest FILE --journal FILE [--execute]

apply and rollback are dry runs unless --execute is supplied.`;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { execute: false };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--execute') options.execute = true;
    else if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      const value = rest[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      options[key] = value;
    } else throw new Error(`Unexpected argument '${arg}'`);
  }
  return { command, options };
}

function requireOptions(options, names) {
  for (const name of names) if (!options[name]) throw new Error(`Missing --${name.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)}`);
}

function readOwnerOnlyJson(filename) {
  const resolved = path.resolve(filename);
  const stat = fs.statSync(resolved);
  if ((stat.mode & 0o077) !== 0) throw new Error('Identity input must not be accessible by group or other users');
  if (typeof process.geteuid === 'function' && stat.uid !== process.geteuid()) {
    throw new Error('Identity input must be owned by the current operating-system user');
  }
  return readJsonDocument(resolved);
}

export function runCli(argv) {
  const { command, options } = parseArgs(argv);
  if (command === 'inventory') {
    requireOptions(options, ['stateRoot', 'workspaceUsersRoot', 'output']);
    const inventory = inventoryTenantPartitions({ stateRoot: options.stateRoot, workspaceRoot: options.workspaceUsersRoot });
    writeJsonDocument(options.output, inventory);
    return { command, output: path.resolve(options.output), partitions: inventory.partitions.length };
  }
  if (command === 'plan') {
    requireOptions(options, ['inventory', 'identities', 'output']);
    const identityDocument = readOwnerOnlyJson(options.identities);
    if (identityDocument.schema !== 'dsh.tenant-identities/v1' || !Array.isArray(identityDocument.identities)) {
      throw new Error('Identity input must use dsh.tenant-identities/v1');
    }
    const manifest = planTenantPartitionMigration({
      inventory: readJsonDocument(options.inventory),
      identities: identityDocument.identities
    });
    writeJsonDocument(options.output, manifest);
    return { command, output: path.resolve(options.output), migrationId: manifest.migrationId, entries: manifest.entries.length };
  }
  if (command === 'apply') {
    requireOptions(options, ['manifest', 'journal']);
    return applyTenantPartitionMigration({
      manifest: readJsonDocument(options.manifest),
      journalPath: path.resolve(options.journal),
      execute: options.execute
    });
  }
  if (command === 'verify') {
    requireOptions(options, ['manifest', 'journal']);
    return verifyTenantPartitionMigration({
      manifest: readJsonDocument(options.manifest),
      journal: readJsonDocument(options.journal)
    });
  }
  if (command === 'rollback') {
    requireOptions(options, ['manifest', 'journal']);
    return rollbackTenantPartitionMigration({
      manifest: readJsonDocument(options.manifest),
      journal: readJsonDocument(options.journal),
      journalPath: path.resolve(options.journal),
      execute: options.execute
    });
  }
  throw new Error(usage());
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = runCli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`tenant-partition-migration: ${error.message}\n`);
    process.exitCode = 1;
  }
}
