#!/usr/bin/env node

/**
 * Authoritative Provisioning Manifest for DeepSeek Harness (DSH-DDS)
 *
 * Single source of truth for all files provisioned into target environments.
 * Defines canonical assets, required vs optional semantics, delivery method
 * (fetch vs heredoc), and cryptographic SHA-256 integrity digests.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const REPO_ROOT = path.resolve(__dirname, '..');

export function computeSha256(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Full catalogue of canonical assets.
 */
export const PROVISIONED_ASSETS = [
  // 1. Embedded Heredoc Targets
  { path: 'config/cordis.patch.yml', required: true, delivery: 'heredoc' },
  { path: 'config/profiles/web/package.json', required: true, delivery: 'heredoc' },
  { path: 'config/profiles/web/cordis.patch.yml', required: true, delivery: 'heredoc' },
  { path: 'Dockerfile', required: true, delivery: 'heredoc' },
  { path: 'docker-compose.yml', required: true, delivery: 'heredoc' },

  // 2. Deployment, Diagnostic, and Lifecycle Scripts
  { path: 'dsh.sh', required: true, delivery: 'fetch' },
  { path: 'reset.sh', required: true, delivery: 'fetch' },
  { path: 'docker-compose.sandbox.yml', required: true, delivery: 'fetch' },
  { path: 'docker-compose.dev.yml', required: true, delivery: 'fetch' },
  { path: 'docker/entrypoint.sh', required: true, delivery: 'fetch' },
  { path: 'services/isolated-executor/server.mjs', required: true, delivery: 'fetch' },
  { path: 'scripts/prepare_executor_workspaces.mjs', required: true, delivery: 'fetch' },
  { path: 'scripts/migrate_tenant_partitions.mjs', required: true, delivery: 'fetch' },
  { path: 'scripts/lib/tenant_partition_migration.mjs', required: true, delivery: 'fetch' },
  { path: 'scripts/export_telemetry.sh', required: false, delivery: 'fetch' },
  { path: 'scripts/prune_telemetry.sh', required: false, delivery: 'fetch' },

  // 3. Core Runtime & Security Modules
  { path: 'config/sync_models.mjs', required: true, delivery: 'fetch' },
  { path: 'config/doctor.mjs', required: true, delivery: 'fetch' },
  { path: 'config/persona.mjs', required: true, delivery: 'fetch' },
  { path: 'config/declarative-orchestrator.mjs', required: true, delivery: 'fetch' },
  { path: 'config/outbound-security.mjs', required: true, delivery: 'fetch' },
  { path: 'config/audit-client.mjs', required: true, delivery: 'fetch' },
  { path: 'config/audit-writer-core.mjs', required: true, delivery: 'fetch' },
  { path: 'config/audit-writer.mjs', required: true, delivery: 'fetch' },
  { path: 'config/telemetry-gateway.mjs', required: true, delivery: 'fetch' },
  { path: 'config/audit-checkpoints/.gitkeep', required: true, delivery: 'fetch' },
  { path: 'config/rbac-policy.mjs', required: true, delivery: 'fetch' },
  { path: 'config/policy-manifest.mjs', required: true, delivery: 'fetch' },
  { path: 'config/settings.default.yaml', required: true, delivery: 'fetch' },
  { path: 'config/phoenix-evals.mjs', required: true, delivery: 'fetch' },
  { path: 'config/context-quarantine.mjs', required: true, delivery: 'fetch' },
  { path: 'config/dynamic-governance.mjs', required: true, delivery: 'fetch' },
  { path: 'config/failover-gateway.mjs', required: true, delivery: 'fetch' },
  { path: 'config/worktree-staging.mjs', required: true, delivery: 'fetch' },
  { path: 'config/network/envoy-egress.yaml', required: true, delivery: 'fetch' },
  { path: 'config/schemas/persona-policy-v1.schema.json', required: true, delivery: 'fetch' },
  { path: 'config/schemas/tenant-partition-migration-v1.schema.json', required: true, delivery: 'fetch' },

  // 4. Core Governance Package (packages/dsh-dds-core)
  { path: 'packages/dsh-dds-core/byok-vault.js', required: true, delivery: 'fetch' },
  { path: 'packages/dsh-dds-core/execution-capability.js', required: true, delivery: 'fetch' },
  { path: 'packages/dsh-dds-core/gateway.js', required: true, delivery: 'fetch' },
  { path: 'packages/dsh-dds-core/iam.js', required: true, delivery: 'fetch' },
  { path: 'packages/dsh-dds-core/index.js', required: true, delivery: 'fetch' },
  { path: 'packages/dsh-dds-core/isolated-shell-executor.js', required: true, delivery: 'fetch' },
  { path: 'packages/dsh-dds-core/llm-gateway.js', required: true, delivery: 'fetch' },
  { path: 'packages/dsh-dds-core/loader-hooks.mjs', required: true, delivery: 'fetch' },
  { path: 'packages/dsh-dds-core/loader.mjs', required: true, delivery: 'fetch' },
  { path: 'packages/dsh-dds-core/localization.js', required: true, delivery: 'fetch' },
  { path: 'packages/dsh-dds-core/model-catalog.js', required: true, delivery: 'fetch' },
  { path: 'packages/dsh-dds-core/net-trust.js', required: true, delivery: 'fetch' },
  { path: 'packages/dsh-dds-core/package.json', required: true, delivery: 'fetch' },
  { path: 'packages/dsh-dds-core/rbac-interceptor.js', required: true, delivery: 'fetch' },
  { path: 'packages/dsh-dds-core/user-partition.js', required: true, delivery: 'fetch' },
  { path: 'packages/dsh-dds-core/web-search.js', required: true, delivery: 'fetch' },

  // 5. Deployment Profiles
  { path: 'config/profiles/cli/cordis.patch.yml', required: true, delivery: 'fetch' },
  { path: 'config/profiles/cli/cordis.yml', required: true, delivery: 'fetch' },
  { path: 'config/profiles/cli/package.json', required: true, delivery: 'fetch' },
  { path: 'config/profiles/cli/pnpm-lock.yaml', required: true, delivery: 'fetch' },
  { path: 'config/profiles/headless/cordis.patch.yml', required: true, delivery: 'fetch' },
  { path: 'config/profiles/headless/cordis.yml', required: true, delivery: 'fetch' },
  { path: 'config/profiles/headless/package.json', required: true, delivery: 'fetch' },
  { path: 'config/profiles/headless/pnpm-workspace.yaml', required: true, delivery: 'fetch' },
  { path: 'config/profiles/web/cordis.yml', required: true, delivery: 'fetch' },
  { path: 'config/profiles/web/pnpm-lock.yaml', required: true, delivery: 'fetch' },
  { path: 'config/profiles/web/pnpm-workspace.yaml', required: true, delivery: 'fetch' },

  // 6. Production Personas
  { path: 'config/personas/data-analyst/SKILL.md', required: true, delivery: 'fetch' },
  { path: 'config/personas/data-analyst/persona.yaml', required: true, delivery: 'fetch' },
  { path: 'config/personas/devops-sre/SKILL.md', required: true, delivery: 'fetch' },
  { path: 'config/personas/devops-sre/persona.yaml', required: true, delivery: 'fetch' },
  { path: 'config/personas/mlops-engineer/SKILL.md', required: true, delivery: 'fetch' },
  { path: 'config/personas/mlops-engineer/persona.yaml', required: true, delivery: 'fetch' },
  { path: 'config/personas/persona-creator/SKILL.md', required: true, delivery: 'fetch' },
  { path: 'config/personas/persona-creator/persona.yaml', required: true, delivery: 'fetch' },
  { path: 'config/personas/playground/SKILL.md', required: true, delivery: 'fetch' },
  { path: 'config/personas/playground/persona.yaml', required: true, delivery: 'fetch' },
  { path: 'config/personas/sdmx-expert/SKILL.md', required: true, delivery: 'fetch' },
  { path: 'config/personas/sdmx-expert/persona.yaml', required: true, delivery: 'fetch' },
  { path: 'config/personas/security-auditor/SKILL.md', required: true, delivery: 'fetch' },
  { path: 'config/personas/security-auditor/persona.yaml', required: true, delivery: 'fetch' },
  { path: 'config/personas/stats-engineer/SKILL.md', required: true, delivery: 'fetch' },
  { path: 'config/personas/stats-engineer/persona.yaml', required: true, delivery: 'fetch' },

  // 7. Domain Skills
  { path: 'config/skills/agentkey/SKILL.md', required: true, delivery: 'fetch' },
  { path: 'config/skills/data-analyst/SKILL.md', required: true, delivery: 'fetch' },
  { path: 'config/skills/devops-sre/SKILL.md', required: true, delivery: 'fetch' },
  { path: 'config/skills/mlops-engineer/SKILL.md', required: true, delivery: 'fetch' },
  { path: 'config/skills/persona-creator/SKILL.md', required: true, delivery: 'fetch' },
  { path: 'config/skills/playground/SKILL.md', required: true, delivery: 'fetch' },
  { path: 'config/skills/sdmx-expert/SKILL.md', required: true, delivery: 'fetch' },
  { path: 'config/skills/security-auditor/SKILL.md', required: true, delivery: 'fetch' },
  { path: 'config/skills/stats-engineer/SKILL.md', required: true, delivery: 'fetch' },

  // 8. Persona Starter Templates
  { path: 'config/templates/personas/base-template/SKILL.md', required: true, delivery: 'fetch' },
  { path: 'config/templates/personas/base-template/persona.yaml', required: true, delivery: 'fetch' },
  { path: 'config/templates/personas/data-analyst/SKILL.md', required: true, delivery: 'fetch' },
  { path: 'config/templates/personas/data-analyst/persona.yaml', required: true, delivery: 'fetch' },
  { path: 'config/templates/personas/devops-sre/SKILL.md', required: true, delivery: 'fetch' },
  { path: 'config/templates/personas/devops-sre/persona.yaml', required: true, delivery: 'fetch' },
  { path: 'config/templates/personas/mlops-engineer/SKILL.md', required: true, delivery: 'fetch' },
  { path: 'config/templates/personas/mlops-engineer/persona.yaml', required: true, delivery: 'fetch' },
  { path: 'config/templates/personas/persona-creator/SKILL.md', required: true, delivery: 'fetch' },
  { path: 'config/templates/personas/persona-creator/persona.yaml', required: true, delivery: 'fetch' },
  { path: 'config/templates/personas/playground/SKILL.md', required: true, delivery: 'fetch' },
  { path: 'config/templates/personas/playground/persona.yaml', required: true, delivery: 'fetch' },
  { path: 'config/templates/personas/sdmx-expert/SKILL.md', required: true, delivery: 'fetch' },
  { path: 'config/templates/personas/sdmx-expert/persona.yaml', required: true, delivery: 'fetch' },
  { path: 'config/templates/personas/security-auditor/SKILL.md', required: true, delivery: 'fetch' },
  { path: 'config/templates/personas/security-auditor/persona.yaml', required: true, delivery: 'fetch' },
  { path: 'config/templates/personas/stats-engineer/SKILL.md', required: true, delivery: 'fetch' },
  { path: 'config/templates/personas/stats-engineer/persona.yaml', required: true, delivery: 'fetch' }
];

/**
 * Builds the manifest with real-time SHA-256 checksums from rootDir.
 */
export function getProvisioningManifest(rootDir = REPO_ROOT) {
  return PROVISIONED_ASSETS.map((asset) => {
    const fullPath = path.join(rootDir, asset.path);
    if (!fs.existsSync(fullPath)) {
      if (asset.required) {
        throw new Error(`Required asset does not exist in repository: ${asset.path}`);
      }
      return { ...asset, sha256: null };
    }
    return {
      ...asset,
      sha256: computeSha256(fullPath)
    };
  });
}

/**
 * Generates the shell lookup function get_manifest_sha256() for embedding into install_dsh.sh.
 */
export function generateBashManifestLookup(rootDir = REPO_ROOT) {
  const manifest = getProvisioningManifest(rootDir);
  const fetchable = manifest.filter((a) => a.delivery === 'fetch' && a.sha256);

  const cases = fetchable
    .map((a) => `    "${a.path}") echo "${a.sha256}" ;;`)
    .join('\n');

  return `get_manifest_sha256() {
  case "$1" in
${cases}
    *) echo "" ;;
  esac
}`;
}
