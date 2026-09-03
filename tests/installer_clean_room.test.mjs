import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

test('Clean-room Installer: provisions full topology in isolated directory', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-clean-room-'));

  try {
    // Copy only install_dsh.sh and Dockerfile into a completely separate runner dir
    const runnerDir = path.join(tmpDir, 'runner');
    const installTarget = path.join(tmpDir, 'installed');
    fs.mkdirSync(runnerDir, { recursive: true });

    // Execute install_dsh.sh pointing DSH_INSTALL to installTarget from repository ROOT
    execSync(`bash ${path.join(ROOT, 'install_dsh.sh')}`, {
      env: {
        ...process.env,
        DSH_INSTALL: installTarget,
        SKIP_DOCKER_CHECKS: 'true'
      },
      cwd: ROOT,
      stdio: 'pipe'
    });

    // Assert that essential assets are provisioned in the target
    assert.ok(fs.existsSync(path.join(installTarget, 'config', 'declarative-orchestrator.mjs')));
    assert.ok(fs.existsSync(path.join(installTarget, 'config', 'rbac-policy.mjs')));
    assert.ok(fs.existsSync(path.join(installTarget, 'config', 'persona.mjs')));
    assert.ok(fs.existsSync(path.join(installTarget, 'config', 'personas', 'security-auditor', 'persona.yaml')));
    assert.ok(fs.existsSync(path.join(installTarget, 'dsh.sh')));
    assert.ok(fs.existsSync(path.join(installTarget, 'docker-compose.yml')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
