#!/usr/bin/env node

/**
 * Single-Source Installer Builder for DeepSeek Harness (DSH-DDS)
 *
 * Deterministically syncs canonical configuration files, manifests, and compose topologies
 * into embedded heredocs inside install_dsh.sh, eliminating manual double-maintenance.
 *
 * Usage:
 *   node scripts/build_installer.mjs         # Updates install_dsh.sh in-place
 *   node scripts/build_installer.mjs --check # Verifies install_dsh.sh matches canonical sources
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
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

export function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function syncHeredoc(installerContent, target) {
  const markerEscaped = escapeRegex(target.marker);
  const regex = new RegExp(`(${markerEscaped}\\n)([\\s\\S]*?)(\\nEOF)`);
  const match = installerContent.match(regex);

  if (!match) {
    throw new Error(`Heredoc marker not found in install_dsh.sh: ${target.marker}`);
  }

  const canonicalContent = fs.readFileSync(target.canonicalPath, 'utf8').trim();
  const currentContent = match[2].trim();

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

  const newSection = `${match[1]}${canonicalContent}${match[3]}`;
  const updatedInstaller = installerContent.replace(regex, newSection);

  return {
    isMatch,
    updatedInstaller,
    target
  };
}

export function verifyProvisionedAssets(installerContent) {
  const missing = [];

  function checkDir(relDir) {
    const fullDir = path.join(ROOT, relDir);
    if (!fs.existsSync(fullDir)) return;
    const entries = fs.readdirSync(fullDir, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        const filePath = path.join(entry.parentPath || entry.path, entry.name);
        const relPath = path.relative(ROOT, filePath);
        const expected = `fetch_or_copy_file "${relPath}"`;
        if (!installerContent.includes(expected)) {
          missing.push(relPath);
        }
      }
    }
  }

  checkDir('config/personas');
  checkDir('config/skills');
  checkDir('config/templates/personas');
  checkDir('packages/dsh-dds-core');

  return missing;
}

export function buildInstaller({ checkOnly = false } = {}) {
  let installerContent = fs.readFileSync(INSTALLER_PATH, 'utf8');
  let hasDrift = false;
  const reports = [];

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

  const missingAssets = verifyProvisionedAssets(installerContent);
  if (missingAssets.length > 0) {
    hasDrift = true;
  }

  if (checkOnly) {
    if (hasDrift) {
      console.error('❌ Installer parity check failed: Discrepancies detected between canonical sources and install_dsh.sh:');
      for (const r of reports.filter(item => item.status === 'DRIFT_DETECTED')) {
        console.error(`  • Heredoc drift: ${r.name} (${r.targetPath})`);
      }
      for (const m of missingAssets) {
        console.error(`  • Missing provisioned asset: ${m}`);
      }
      return false;
    }
    console.log('✅ Installer parity verified: install_dsh.sh is 100% in sync with canonical sources.');
    return true;
  }

  // Write updated installer
  fs.writeFileSync(INSTALLER_PATH, installerContent, 'utf8');
  fs.chmodSync(INSTALLER_PATH, 0o755);
  console.log('✅ Deterministically generated install_dsh.sh with latest canonical heredocs:');
  for (const r of reports) {
    console.log(`  • ${r.name} -> ${r.targetPath} (${r.status})`);
  }
  if (missingAssets.length > 0) {
    console.warn(`⚠️ Warning: Some repository assets are not provisioned in install_dsh.sh:`, missingAssets);
  }
  return true;
}

// CLI entrypoint
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const isCheck = process.argv.includes('--check') || process.argv.includes('-c');
  const success = buildInstaller({ checkOnly: isCheck });
  process.exit(success ? 0 : 1);
}
