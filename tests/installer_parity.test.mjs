import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());

test('Installer Parity: package.json matches config/profiles/web/package.json', () => {
  const committed = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/profiles/web/package.json'), 'utf8'));
  const installScript = fs.readFileSync(path.join(ROOT, 'install_dsh.sh'), 'utf8');
  const match = installScript.match(/cat << 'EOF' > "\$DSH_INSTALL\/config\/profiles\/web\/package\.json"\n([\s\S]*?)\nEOF/);
  assert.ok(match, 'package.json heredoc found in install_dsh.sh');
  const templated = JSON.parse(match[1]);
  assert.deepEqual(committed, templated, 'install_dsh.sh package.json must match canonical file');
});

test('Installer Parity: cordis.patch.yml matches config/profiles/web/cordis.patch.yml', () => {
  const committed = fs.readFileSync(path.join(ROOT, 'config/profiles/web/cordis.patch.yml'), 'utf8').trim();
  const installScript = fs.readFileSync(path.join(ROOT, 'install_dsh.sh'), 'utf8');
  const match = installScript.match(/cat << 'EOF' > "\$DSH_INSTALL\/config\/profiles\/web\/cordis\.patch\.yml"\n([\s\S]*?)\nEOF/);
  assert.ok(match, 'cordis.patch.yml heredoc found in install_dsh.sh');
  const templated = match[1].trim();
  assert.equal(committed, templated, 'install_dsh.sh cordis.patch.yml must match canonical file');
});

test('Installer Parity: Dockerfile template matches canonical Dockerfile', () => {
  const committed = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8').trim();
  const installScript = fs.readFileSync(path.join(ROOT, 'install_dsh.sh'), 'utf8');
  const match = installScript.match(/cat << 'EOF' > "\$DSH_INSTALL\/Dockerfile"\n([\s\S]*?)\nEOF/);
  assert.ok(match, 'Dockerfile heredoc found in install_dsh.sh');
  const templated = match[1].trim();
  assert.equal(committed, templated, 'install_dsh.sh Dockerfile must match canonical file');
});

test('Installer Parity: docker-compose.yml template matches canonical docker-compose.yml', () => {
  const committed = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8').trim();
  const installScript = fs.readFileSync(path.join(ROOT, 'install_dsh.sh'), 'utf8');
  const match = installScript.match(/cat << 'EOF' > "\$DSH_INSTALL\/docker-compose\.yml"\n([\s\S]*?)\nEOF/);
  assert.ok(match, 'docker-compose.yml heredoc found in install_dsh.sh');
  const templated = match[1].trim();
  assert.equal(committed, templated, 'install_dsh.sh docker-compose.yml must match canonical file');
});

test('Installer Parity: bootstrap entrypoint is provisioned', () => {
  const installScript = fs.readFileSync(path.join(ROOT, 'install_dsh.sh'), 'utf8');
  assert.match(installScript, /fetch_or_copy_file "docker\/entrypoint\.sh"/);
  assert.match(installScript, /chmod \+x "\$DSH_INSTALL\/docker\/entrypoint\.sh"/);
});

test('Installer Parity: all canonical personas, skills, and templates are provisioned in install_dsh.sh', () => {
  const installScript = fs.readFileSync(path.join(ROOT, 'install_dsh.sh'), 'utf8');

  function assertDirAssets(relDir) {
    const fullDir = path.join(ROOT, relDir);
    if (!fs.existsSync(fullDir)) return;
    const entries = fs.readdirSync(fullDir, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        const filePath = path.join(entry.parentPath || entry.path, entry.name);
        const relPath = path.relative(ROOT, filePath);
        assert.ok(
          installScript.includes(`fetch_or_copy_file "${relPath}"`),
          `install_dsh.sh must provision canonical asset: ${relPath}`
        );
      }
    }
  }

  assertDirAssets('config/personas');
  assertDirAssets('config/skills');
  assertDirAssets('config/templates/personas');
});

test('Installer Parity: runtime scripts and profile assets are provisioned', () => {
  const installScript = fs.readFileSync(path.join(ROOT, 'install_dsh.sh'), 'utf8');
  const required = [
    'config/sync_models.mjs',
    'config/doctor.mjs',
    'config/persona.mjs',
    'config/patch_translations.mjs',
    'config/patch-pi-ai.mjs',
    'config/patch-bash-local.mjs',
    'config/patch-client-connection.mjs',
    'config/declarative-orchestrator.mjs',
    'config/rbac-policy.mjs',
    'config/settings.default.yaml',
    'dsh.sh',
    'reset.sh',
    'docker-compose.sandbox.yml',
    'docker/entrypoint.sh',
    'config/profiles/web/pnpm-lock.yaml',
    'config/profiles/cli/pnpm-lock.yaml'
  ];

  for (const item of required) {
    assert.ok(
      installScript.includes(`fetch_or_copy_file "${item}"`),
      `install_dsh.sh must provision runtime dependency: ${item}`
    );
  }
});
