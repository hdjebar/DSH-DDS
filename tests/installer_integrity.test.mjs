import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildInstaller,
  verifyProvisionedAssets,
  verifyRepositoryAssetCoverage
} from '../scripts/build_installer.mjs';
import {
  PROVISIONED_ASSETS,
  getProvisioningManifest
} from '../scripts/provisioning-manifest.mjs';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const INSTALL_SCRIPT = path.join(ROOT, 'install_dsh.sh');

function extractBashFunction(content, name) {
  const startIdx = content.indexOf(name + '() {');
  if (startIdx === -1) throw new Error(`Function ${name} not found in install_dsh.sh`);
  let braceCount = 0;
  let foundFirst = false;
  for (let i = startIdx; i < content.length; i++) {
    if (content[i] === '{') {
      braceCount++;
      foundFirst = true;
    } else if (content[i] === '}') {
      braceCount--;
      if (foundFirst && braceCount === 0) {
        return content.slice(startIdx, i + 1);
      }
    }
  }
  throw new Error(`Unterminated function body for ${name}`);
}

test('Installer Integrity: load_env_safely filters dangerous variables and supply-chain redirects (Finding H-1)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-env-test-'));
  const envFile = path.join(tmpDir, '.env');
  const installContent = fs.readFileSync(INSTALL_SCRIPT, 'utf8');
  const loadEnvSafelyFunc = extractBashFunction(installContent, 'load_env_safely');

  fs.writeFileSync(
    envFile,
    `
LD_PRELOAD=/evil/libpreload.so
LD_LIBRARY_PATH=/evil/lib
BASH_ENV=/evil/bash_init.sh
ENV=/evil/sh_init.sh
SHELLOPTS=xtrace
NODE_OPTIONS="--require /evil/hook.js"
DSH_REPO_URL=https://attacker.example.com/repo
DSH_SOURCE_DIR=/tmp/attacker-source
DSH_REF=malicious-branch
DSH_INSTALL=/etc/pwned
ATTACKER_INJECTED_VAR=dangerous_payload
DSH_PORT=3090
GEMINI_API_KEY=test-gemini-token-xyz
PHOENIX_SECRET=test-phoenix-secret-abc
PHOENIX_ADMIN_SECRET=dsh0_superadmin
`
  );

  const bashScript = `
${loadEnvSafelyFunc}

load_env_safely "${envFile}"
echo "LD_PRELOAD=\${LD_PRELOAD:-UNSET}"
echo "LD_LIBRARY_PATH=\${LD_LIBRARY_PATH:-UNSET}"
echo "BASH_ENV=\${BASH_ENV:-UNSET}"
echo "ENV=\${ENV:-UNSET}"
echo "NODE_OPTIONS=\${NODE_OPTIONS:-UNSET}"
echo "DSH_REPO_URL=\${DSH_REPO_URL:-UNSET}"
echo "DSH_SOURCE_DIR=\${DSH_SOURCE_DIR:-UNSET}"
echo "DSH_REF=\${DSH_REF:-UNSET}"
echo "DSH_INSTALL=\${DSH_INSTALL:-UNSET}"
echo "ATTACKER_INJECTED_VAR=\${ATTACKER_INJECTED_VAR:-UNSET}"
echo "DSH_PORT=\${DSH_PORT:-UNSET}"
echo "GEMINI_API_KEY=\${GEMINI_API_KEY:-UNSET}"
echo "PHOENIX_SECRET=\${PHOENIX_SECRET:-UNSET}"
echo "PHOENIX_ADMIN_SECRET=\${PHOENIX_ADMIN_SECRET:-UNSET}"
`;

  const output = execFileSync('bash', ['-c', bashScript], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH }
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });

  assert.match(output, /LD_PRELOAD=UNSET/);
  assert.match(output, /LD_LIBRARY_PATH=UNSET/);
  assert.match(output, /BASH_ENV=UNSET/);
  assert.match(output, /ENV=UNSET/);
  assert.match(output, /NODE_OPTIONS=UNSET/);
  assert.match(output, /DSH_REPO_URL=UNSET/);
  assert.match(output, /DSH_SOURCE_DIR=UNSET/);
  assert.match(output, /DSH_REF=UNSET/);
  assert.match(output, /DSH_INSTALL=UNSET/);
  assert.match(output, /ATTACKER_INJECTED_VAR=UNSET/);
  assert.match(output, /DSH_PORT=3090/);
  assert.match(output, /GEMINI_API_KEY=test-gemini-token-xyz/);
  assert.match(output, /PHOENIX_SECRET=test-phoenix-secret-abc/);
  assert.match(output, /PHOENIX_ADMIN_SECRET=dsh0_superadmin/);
});

test('Installer Integrity: invalid DSH_PORT format is rejected (L-8)', () => {
  const invalidPorts = ['3080 9090', 'abc', '-1', '70000', '0', '3080;rm -rf /'];

  for (const port of invalidPorts) {
    const bashScript = `
DSH_PORT="${port}"
if [ -n "\${DSH_PORT:-}" ]; then
  if ! [[ "$DSH_PORT" =~ ^[0-9]{1,5}$ ]] || [ "$DSH_PORT" -lt 1 ] || [ "$DSH_PORT" -gt 65535 ]; then
    echo "REJECTED_PORT"
    exit 1
  fi
fi
echo "ACCEPTED_PORT"
`;
    assert.throws(
      () => {
        execFileSync('bash', ['-c', bashScript], { encoding: 'utf8' });
      },
      /REJECTED_PORT/,
      `Port '${port}' must be rejected`
    );
  }

  const validPorts = ['80', '3080', '8080', '65535'];
  for (const port of validPorts) {
    const bashScript = `
DSH_PORT="${port}"
if [ -n "\${DSH_PORT:-}" ]; then
  if ! [[ "$DSH_PORT" =~ ^[0-9]{1,5}$ ]] || [ "$DSH_PORT" -lt 1 ] || [ "$DSH_PORT" -gt 65535 ]; then
    echo "REJECTED_PORT"
    exit 1
  fi
fi
echo "ACCEPTED_PORT"
`;
    const output = execFileSync('bash', ['-c', bashScript], { encoding: 'utf8' });
    assert.match(output, /ACCEPTED_PORT/);
  }
});

test('Installer Integrity: verify_file_checksum aborts on tampered fallback download (Finding H-2)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-verify-test-'));
  const testTarget = 'config/sync_models.mjs';
  const canonicalFile = path.join(ROOT, testTarget);

  const authenticFile = path.join(tmpDir, 'authentic.mjs');
  fs.copyFileSync(canonicalFile, authenticFile);

  const tamperedFile = path.join(tmpDir, 'tampered.mjs');
  fs.writeFileSync(tamperedFile, '// Malicious injected payload\nconsole.log("pwned");\n');

  const installContent = fs.readFileSync(INSTALL_SCRIPT, 'utf8');
  const getManifestFunc = extractBashFunction(installContent, 'get_manifest_sha256');
  const verifyChecksumFunc = extractBashFunction(installContent, 'verify_file_checksum');

  const helperFunctions = `
${getManifestFunc}
${verifyChecksumFunc}
`;

  // 1. Authentic file passes
  const verifyAuthentic = `
${helperFunctions}
verify_file_checksum "${authenticFile}" "${testTarget}"
`;
  const authenticOutput = execFileSync('bash', ['-c', verifyAuthentic], { encoding: 'utf8' });
  assert.match(authenticOutput, /Verified SHA-256 integrity/);

  // 2. Tampered file aborts with exit code 1 and SHA-256 mismatch
  const verifyTampered = `
${helperFunctions}
verify_file_checksum "${tamperedFile}" "${testTarget}"
`;
  assert.throws(
    () => {
      execFileSync('bash', ['-c', verifyTampered], { encoding: 'utf8' });
    },
    (err) => {
      const combined = (err.stdout || '') + (err.stderr || '');
      return combined.includes('SHA-256 mismatch');
    },
    'Tampered file must abort with SHA-256 mismatch'
  );

  // 3. Unregistered asset aborts fail-closed
  const verifyUnregistered = `
${helperFunctions}
verify_file_checksum "${authenticFile}" "unknown/malicious.sh"
`;
  assert.throws(
    () => {
      execFileSync('bash', ['-c', verifyUnregistered], { encoding: 'utf8' });
    },
    (err) => {
      const combined = (err.stdout || '') + (err.stderr || '');
      return combined.includes('No authoritative SHA-256 hash defined in provisioning manifest');
    },
    'Unregistered file must abort fail-closed'
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Installer Integrity: .env generation creates file with strict 0600 permissions without world-readable window (Finding M-7)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-umask-test-'));
  const envFile = path.join(tmpDir, '.env');

  const bashScript = `
(
  umask 077
  cat << EOF > "${envFile}"
DSH_PORT=3080
GEMINI_API_KEY=test-secret
EOF
)
`;
  execFileSync('bash', ['-c', bashScript]);

  const stat = fs.statSync(envFile);
  const mode = stat.mode & 0o777;
  fs.rmSync(tmpDir, { recursive: true, force: true });

  assert.equal(mode, 0o600, `.env file must be created mode 0600, got 0${mode.toString(8)}`);
});

test('Installer Integrity: build_installer --check passes with 100% manifest and repo coverage (Finding R-4, M-9)', () => {
  const installerContent = fs.readFileSync(INSTALL_SCRIPT, 'utf8');

  const missingAssets = verifyProvisionedAssets(installerContent);
  assert.deepEqual(missingAssets, [], 'All declared manifest assets must be provisioned in install_dsh.sh');

  const uncoveredRepoAssets = verifyRepositoryAssetCoverage();
  assert.deepEqual(
    uncoveredRepoAssets,
    [],
    'All repository assets in core directories must be tracked in provisioning manifest'
  );

  const manifest = getProvisioningManifest(ROOT);
  assert.ok(manifest.length >= 90, `Manifest must track at least 90 assets, got ${manifest.length}`);

  const checkResult = buildInstaller({ checkOnly: true });
  assert.equal(checkResult, true, 'buildInstaller({ checkOnly: true }) must pass with zero drift');
});
