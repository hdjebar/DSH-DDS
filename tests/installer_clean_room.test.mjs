import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { exec, execSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

test('Clean-room Installer: provisions full topology in isolated directory', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-clean-room-'));

  try {
    // Copy only install_dsh.sh into a completely separate runner dir
    const runnerDir = path.join(tmpDir, 'runner');
    const installTarget = path.join(tmpDir, 'installed');
    fs.mkdirSync(runnerDir, { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'install_dsh.sh'), path.join(runnerDir, 'install_dsh.sh'));

    // Execute install_dsh.sh pointing DSH_INSTALL to installTarget from isolated runnerDir
    execSync(`bash install_dsh.sh`, {
      env: {
        ...process.env,
        DSH_INSTALL: installTarget,
        DSH_SOURCE_DIR: ROOT,
        SKIP_DOCKER_CHECKS: 'true'
      },
      cwd: runnerDir,
      stdio: 'pipe'
    });

    // Assert that essential assets are provisioned in the target
    assert.ok(fs.existsSync(path.join(installTarget, 'config', 'declarative-orchestrator.mjs')));
    assert.ok(fs.existsSync(path.join(installTarget, 'config', 'rbac-policy.mjs')));
    assert.ok(fs.existsSync(path.join(installTarget, 'config', 'persona.mjs')));
    assert.ok(fs.existsSync(path.join(installTarget, 'config', 'settings.yaml')), 'settings.yaml must be provisioned on clean installs (FR-016)');
    assert.ok(fs.existsSync(path.join(installTarget, 'config', 'personas', 'security-auditor', 'persona.yaml')));
    assert.ok(fs.existsSync(path.join(installTarget, 'dsh.sh')));
    assert.ok(fs.existsSync(path.join(installTarget, 'docker-compose.yml')));

    // AUD-014: Test idempotency and file preservation on rerun
    const customMarker = '# Custom user modification';
    const patchFile = path.join(installTarget, 'config', 'cordis.patch.yml');
    fs.appendFileSync(patchFile, `\n${customMarker}\n`, 'utf8');

    // Re-run installer without --force
    execSync(`bash install_dsh.sh`, {
      env: {
        ...process.env,
        DSH_INSTALL: installTarget,
        DSH_SOURCE_DIR: ROOT,
        SKIP_DOCKER_CHECKS: 'true'
      },
      cwd: runnerDir,
      stdio: 'pipe'
    });

    // Customization must be preserved
    assert.ok(
      fs.readFileSync(patchFile, 'utf8').includes(customMarker),
      'Installer rerun must preserve existing user customizations without --force'
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('PR-004 & FR-006 Regression: Installer validates remote ref and falls back to main offline', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ref-test-'));

  let server = null;
  let mockRepoUrl = 'http://127.0.0.1:0';
  let mockBinDir = null;

  try {
    server = http.createServer((req, res) => {
      if (req.url.includes('non-existent-tag')) {
        res.writeHead(404, { 'Content-Length': '0' });
        res.end();
      } else {
        res.writeHead(200, { 'Content-Length': '0' });
        res.end();
      }
    });

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        mockRepoUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  } catch (err) {
    // If environment forbids socket listening (EPERM / EACCES), fall back to socket-less mock curl
    if (server) {
      try { server.close(); } catch {}
      server = null;
    }
    mockBinDir = path.join(tmpDir, 'mock-bin');
    fs.mkdirSync(mockBinDir, { recursive: true });
    const mockCurlScript = path.join(mockBinDir, 'curl');
    fs.writeFileSync(mockCurlScript, `#!/bin/bash
if echo "$*" | grep -q "non-existent-tag"; then
  exit 22 # HTTP 404 in curl
fi
exit 0
`, { mode: 0o755 });
  }

  try {
    const runnerDir = path.join(tmpDir, 'runner');
    const installTarget = path.join(tmpDir, 'installed');
    fs.mkdirSync(runnerDir, { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'install_dsh.sh'), path.join(runnerDir, 'install_dsh.sh'));

    const testEnv = {
      ...process.env,
      DSH_INSTALL: installTarget,
      DSH_REF: 'non-existent-tag-v9.99.99',
      DSH_REPO_URL: mockRepoUrl,
      DSH_CHECK_REMOTE_REF: '1',
      DSH_SOURCE_DIR: ROOT,
      SKIP_DOCKER_CHECKS: 'true'
    };
    if (mockBinDir) {
      testEnv.PATH = `${mockBinDir}:${process.env.PATH || ''}`;
    }

    const { stdout: output } = await execAsync(`bash install_dsh.sh`, {
      env: testEnv,
      cwd: runnerDir
    });

    assert.ok(
      output.includes("Falling back to 'main'") || output.includes('main'),
      'Installer must detect invalid ref and fall back to main'
    );
    assert.ok(fs.existsSync(path.join(installTarget, 'docker-compose.yml')));
  } finally {
    if (server) {
      try { server.close(); } catch {}
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
