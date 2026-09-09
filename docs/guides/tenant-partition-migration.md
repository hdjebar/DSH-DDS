# Tenant Partition Migration

This runbook migrates legacy, normalized tenant directories to issuer-bound `u2` partition
IDs. The tool is deliberately dry-run-first and never prints file contents. Run it while DSH
is stopped so no sessions, workspaces, or vaults can change during inventory or movement.

The workflow moves both user state and workspace directories. Each move stays within its
original filesystem and is atomic. Before a move, the complete directory is copied to a
restricted backup and verified by a content fingerprint. Plans and journals carry SHA-256
integrity fields; these detect accidental or unauthorized edits, but are not signatures.

## 1. Inventory

Use the users directory itself for each root. For a Compose installation these are normally
the host directories mounted at `/var/lib/dsh/users` and `/workspaces/users`.

```sh
node scripts/migrate_tenant_partitions.mjs inventory \
  --state-root ./config/users \
  --workspace-users-root ./workspaces/users \
  --output ./tenant-inventory.json
```

Inventory fails on symlinks or unsupported filesystem objects inside a migration source. It
records only partition names, counts, sizes, and cryptographic fingerprints—not secret
contents or nested filenames. Review `unmanagedEntries`; the tool will not touch them.

## 2. Adjudicate ownership and plan

Create a root-owned, mode `0600` identity input. Every inventoried legacy partition must have
an explicit owner selection. `issuer` and `subject` must match the stable identity claims used
by authentication. `ownershipEvidence` should reference an independently reviewed record,
not contain a credential.

```json
{
  "schema": "dsh.tenant-identities/v1",
  "identities": [
    {
      "issuer": "https://idp.example/realms/prod",
      "subject": "248289761001",
      "legacyPartitionId": "alice_example_com",
      "decision": "migrate",
      "ownershipEvidence": "IAM-CHANGE-1842"
    }
  ]
}
```

If several identities normalize to the same legacy ID, choose exactly one `migrate` record
and mark every other record `skip` with a non-empty `adjudicationReason`. The planner refuses
unclaimed partitions, missing evidence, multiple selected owners, reused destinations, and
existing destination directories.

```sh
node scripts/migrate_tenant_partitions.mjs plan \
  --inventory ./tenant-inventory.json \
  --identities ./tenant-identities.json \
  --output ./tenant-migration.json
```

The JSON Schema for the resulting plan is
[`config/schemas/tenant-partition-migration-v1.schema.json`](../../config/schemas/tenant-partition-migration-v1.schema.json).
Store the inventory, identity decision, and manifest with the approved change record.

## 3. Dry-run and apply

Dry-run is the default. It rechecks the plan integrity, canonical roots, source fingerprints,
destination absence, backup absence, path containment, and symlink prohibition.

```sh
node scripts/migrate_tenant_partitions.mjs apply \
  --manifest ./tenant-migration.json \
  --journal ./tenant-migration.journal.json
```

After review, repeat with `--execute`:

```sh
node scripts/migrate_tenant_partitions.mjs apply \
  --manifest ./tenant-migration.json \
  --journal ./tenant-migration.journal.json \
  --execute
```

The apply operation acquires locks in both roots, creates backups under
`.dsh-migration-backups/<migration-id>/`, verifies every backup, and atomically renames each
source. A failure restores moves completed by that invocation. Re-running a completed apply
with the same journal is idempotent and performs verification only.

Migration IDs are runtime-validated UUIDs. Backup roots, migration directories, and backup
targets must remain contained by their state or workspace root and may not traverse symlinks.

## 4. Verify and configure compatibility

```sh
node scripts/migrate_tenant_partitions.mjs verify \
  --manifest ./tenant-migration.json \
  --journal ./tenant-migration.journal.json
```

Generate the temporary runtime compatibility map only from approved manifest entries:

```json
{
  "u2_generated_partition_id": "legacy_partition_id"
}
```

Do not construct the map from guesses or normalized user input. Keep compatibility reads for
the shortest validated transition period; writes should target only `u2` paths.

## 5. Roll back

Stop DSH before rollback. Rollback is also dry-run-first:

```sh
node scripts/migrate_tenant_partitions.mjs rollback \
  --manifest ./tenant-migration.json \
  --journal ./tenant-migration.journal.json

node scripts/migrate_tenant_partitions.mjs rollback \
  --manifest ./tenant-migration.json \
  --journal ./tenant-migration.journal.json \
  --execute
```

Rollback refuses to proceed if a migrated destination has changed, if the legacy source has
reappeared, or if the verified backup is missing. This prevents post-migration writes from
being silently discarded. Preserve the backup, manifest, and journal until the migration's
retention period expires.

Rollback progress is journaled after every restored resource. If an interruption leaves the
journal in `rolling_back` or `rollback_failed`, inspect the recorded error, correct the
operational cause, run the rollback dry-run again, and then repeat with `--execute`. The tool
recognizes already restored resources by fingerprint and resumes only the pending moves; do
not manually move either side while recovering.
