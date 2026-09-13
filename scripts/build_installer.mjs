#!/usr/bin/env node

/**
 * Single-Source Installer Builder for DeepSeek Harness (DSH-DDS)
 *
 * Deterministically syncs canonical configuration files, manifests, and compose topologies
 * into embedded heredocs and provisioning manifests inside install_dsh.sh, eliminating manual double-maintenance.
 *
 * Usage:
 *   node scripts/build_installer.mjs         # Updates install_dsh.sh in-place
 *   node scripts/build_installer.mjs --check # Verifies install_dsh.sh matches canonical sources
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PROVISIONED_ASSETS,
  generateBashManifestLookup,
  REPO_ROOT as ROOT
} from './provisioning-manifest.mjs';

const __filename = fileURLToPath(import.meta.url);
const INSTALLER_PATH = path.join(ROOT, 'install_dsh.sh');

export const HEREDOC_TARGETS = [
  {
    name: 'Root Cordis Patch',
    canonicalPath: path.join(ROOT, 'config/cordis.patch.yml'),
    marker: 'cat << \'EOF\' > "$DSH_INSTALL/config/cordis.patch.yml"',
    targetPath: '$DSH_INSTALL/config/cordis.patch.yml'
  },
  {
    name: 'Web Profile package.json',
    canonicalPath: path.join(ROOT, 'config/profiles/web/package.json'),
    marker: 'cat << \'EOF\' > "$DSH_INSTALL/config/profiles/web/package.json"',
    targetPath: '$DSH_INSTALL/config/profiles/web/package.json',
    isJson: true
  },
  {
    name: 'Web Profile cordis.patch.yml',
    canonicalPath: path.join(ROOT, 'config/profiles/web/cordis.patch.yml'),
    marker: 'cat << \'EOF\' > "$DSH_INSTALL/config/profiles/web/cordis.patch.yml"',
    targetPath: '$DSH_INSTALL/config/profiles/web/cordis.patch.yml'
  },
  {
    name: 'Dockerfile',
    canonicalPath: path.join(ROOT, 'Dockerfile'),
    marker: 'cat << \'EOF\' > "$DSH_INSTALL/Dockerfile"',
    targetPath: '$DSH_INSTALL/Dockerfile'
  },
  {
    name: 'docker-compose.yml',
    canonicalPath: path.join(ROOT, 'docker-compose.yml'),
    marker: 'cat << \'EOF\' > "$DSH_INSTALL/docker-compose.yml"',
    targetPath: '$DSH_INSTALL/docker-compose.yml'
  }
];

export const MANIFEST_START_MARKER = '# --- BEGIN PROVISIONING MANIFEST ---';
export const MANIFEST_END_MARKER = '# --- END PROVISIONING MANIFEST ---';

export function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Synchronizes heredoc blocks using deterministic string slicing.
 * Avoids regex truncation on inner EOF and prevents $& replacement interpretation (L-5).
 */
export function syncHeredoc(installerContent, target) {
  const startIndex = installerContent.indexOf(target.marker);
  if (startIndex === -1) {
    throw new Error(`Heredoc marker not found in install_dsh.sh: ${target.marker}`);
  }

  const contentStart = startIndex + target.marker.length + 1;
  const endMarker = target.endMarker || '\nEOF\n';
  const closingIndex = installerContent.indexOf(endMarker, contentStart);

  if (closingIndex === -1) {
    throw new Error(`Closing marker '${endMarker.trim()}' not found for heredoc: ${target.marker}`);
  }

  const canonicalContent = fs.readFileSync(target.canonicalPath, 'utf8').trim();
  const currentContent = installerContent.slice(contentStart, closingIndex).trim();

  let isMatch = false;
  if (target.isJson) {
    try {
      const parsedCanonical = JSON.parse(canonicalContent);
      const parsedCurrent = JSON.parse(currentContent);
      isMatch = JSON.stringify(parsedCanonical) === JSON.stringify(parsedCurrent);
    } catch {
      isMatch = false;
    }
  } else {
    isMatch = canonicalContent === currentContent;
  }

  const updatedInstaller =
    installerContent.slice(0, startIndex) +
    target.marker + '\n' +
    canonicalContent +
    installerContent.slice(closingIndex);

  return {
    isMatch,
    updatedInstaller,
    target
  };
}

/**
 * Synchronizes the embedded provisioning manifest hash lookup function.
 */
export function syncManifestLookup(installerContent) {
  const startIndex = installerContent.indexOf(MANIFEST_START_MARKER);
  if (startIndex === -1) {
    throw new Error(`Manifest start marker not found in install_dsh.sh: ${MANIFEST_START_MARKER}`);
  }
  const contentStart = startIndex + MANIFEST_START_MARKER.length + 1;
  const closingIndex = installerContent.indexOf(MANIFEST_END_MARKER, contentStart);
  if (closingIndex === -1) {
    throw new Error(`Manifest end marker not found in install_dsh.sh: ${MANIFEST_END_MARKER}`);
  }

  const expectedLookup = generateBashManifestLookup(ROOT).trim();
  const currentLookup = installerContent.slice(contentStart, closingIndex).trim();
  const isMatch = expectedLookup === currentLookup;

  const updatedInstaller =
    installerContent.slice(0, startIndex) +
    MANIFEST_START_MARKER + '\n' +
    expectedLookup + '\n' +
    installerContent.slice(closingIndex);

  return {
    isMatch,
    updatedInstaller
  };
}

/**
 * Verifies that all assets defined in PROVISIONED_ASSETS are accounted for in install_dsh.sh (R-4).
 */
export function verifyProvisionedAssets(installerContent) {
  const missing = [];
  for (const asset of PROVISIONED_ASSETS) {
    if (asset.delivery === 'heredoc') {
      const expected = `"$DSH_INSTALL/${asset.path}"`;
      if (!installerContent.includes(expected)) {
        missing.push(`${asset.path} (missing heredoc)`);
      }
    } else {
      const expected = `fetch_or_copy_file "${asset.path}"`;
      if (!installerContent.includes(expected)) {
        missing.push(asset.path);
      }
    }
  }
  return missing;
}

/**
 * Verifies that repository files in critical directories are tracked in provisioning-manifest.mjs.
 */
export function verifyRepositoryAssetCoverage() {
  const uncovered = [];
  const manifestPaths = new Set(PROVISIONED_ASSETS.map((a) => a.path));

  function checkDir(relDir) {
    const fullDir = path.join(ROOT, relDir);
    if (!fs.existsSync(fullDir)) return;
    const entries = fs.readdirSync(fullDir, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        const filePath = path.join(entry.parentPath || entry.path, entry.name);
        const relPath = path.relative(ROOT, filePath);
        if (!manifestPaths.has(relPath)) {
          uncovered.push(relPath);
        }
      }
    }
  }

  checkDir('config/personas');
  checkDir('config/skills');
  checkDir('config/templates/personas');
  checkDir('packages/dsh-dds-core');
  checkDir('config/profiles');
  checkDir('config/schemas');

  return uncovered;
}

export function buildInstaller({ checkOnly = false } = {}) {
  let installerContent = fs.readFileSync(INSTALLER_PATH, 'utf8');
  let hasDrift = false;
  const reports = [];

  // 1. Heredoc targets
  for (const target of HEREDOC_TARGETS) {
    const result = syncHeredoc(installerContent, target);
    if (!result.isMatch) {
      hasDrift = true;
      reports.push({
        name: target.name,
        targetPath: target.targetPath,
        status: 'DRIFT_DETECTED'
      });
      if (!checkOnly) {
        installerContent = result.updatedInstaller;
      }
    } else {
      reports.push({
        name: target.name,
        targetPath: target.targetPath,
        status: 'IN_SYNC'
      });
    }
  }

  // 2. Embedded Provisioning Manifest Lookup
  const manifestResult = syncManifestLookup(installerContent);
  if (!manifestResult.isMatch) {
    hasDrift = true;
    reports.push({
      name: 'Provisioning Manifest Hashes',
      targetPath: 'get_manifest_sha256',
      status: 'DRIFT_DETECTED'
    });
    if (!checkOnly) {
      installerContent = manifestResult.updatedInstaller;
    }
  } else {
    reports.push({
      name: 'Provisioning Manifest Hashes',
      targetPath: 'get_manifest_sha256',
      status: 'IN_SYNC'
    });
  }

  // 3. Asset completeness
  const missingAssets = verifyProvisionedAssets(installerContent);
  if (missingAssets.length > 0) {
    hasDrift = true;
  }

  // 4. Repository coverage
  const uncoveredAssets = verifyRepositoryAssetCoverage();
  if (uncoveredAssets.length > 0) {
    hasDrift = true;
  }

  if (checkOnly) {
    if (hasDrift) {
      console.error('❌ Installer parity check failed: Discrepancies detected between canonical sources and install_dsh.sh:');
      for (const r of reports.filter((item) => item.status === 'DRIFT_DETECTED')) {
        console.error(`  • Drift: ${r.name} (${r.targetPath})`);
      }
      for (const m of missingAssets) {
        console.error(`  • Missing provisioned asset in installer: ${m}`);
      }
      for (const u of uncoveredAssets) {
        console.error(`  • Repository asset not in provisioning manifest: ${u}`);
      }
      return false;
    }
    console.log('✅ Installer parity verified: install_dsh.sh is 100% in sync with canonical sources.');
    return true;
  }

  // Write updated installer
  fs.writeFileSync(INSTALLER_PATH, installerContent, 'utf8');
  fs.chmodSync(INSTALLER_PATH, 0o755);
  console.log('✅ Deterministically generated install_dsh.sh with latest canonical heredocs and manifest:');
  for (const r of reports) {
    console.log(`  • ${r.name} -> ${r.targetPath} (${r.status})`);
  }
  if (missingAssets.length > 0) {
    console.warn(`⚠️ Warning: Some repository assets are not provisioned in install_dsh.sh:`, missingAssets);
  }
  if (uncoveredAssets.length > 0) {
    console.warn(`⚠️ Warning: Some repository assets are not registered in provisioning manifest:`, uncoveredAssets);
  }
  return true;
}

// CLI entrypoint
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const isCheck = process.argv.includes('--check') || process.argv.includes('-c');
  const success = buildInstaller({ checkOnly: isCheck });
  process.exit(success ? 0 : 1);
}
