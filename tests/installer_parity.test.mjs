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

test('Installer Parity: bootstrap entrypoint is provisioned and made executable', () => {
  const installScript = fs.readFileSync(path.join(ROOT, 'install_dsh.sh'), 'utf8');
  assert.match(installScript, /fetch_or_copy_file "docker\/entrypoint\.sh"/);
  // Every provisioned *.sh is chmod'd in one sweep rather than a hand-listed few.
  assert.match(installScript, /find "\$DSH_INSTALL" -type f -name '\*\.sh' -exec chmod \+x \{\} \+/);
});

// Guards the class of defect where install_dsh.sh silently stops provisioning files
// that the repository ships — the turnkey install then differs from a git clone.
const HEREDOC_PROVISIONED = new Set([
  'config/cordis.patch.yml',
  'config/profiles/web/package.json',
  'config/profiles/web/cordis.patch.yml',
  'Dockerfile',
  'docker-compose.yml'
]);

const REQUIRED_TOP_LEVEL = [
  'config/sync_models.mjs',
  'config/doctor.mjs',
  'config/persona.mjs',
  'config/patch_translations.mjs',
  'config/patch-pi-ai.mjs',
  'config/settings.yaml',
  'dsh.sh',
  'reset.sh',
  'docker-compose.sandbox.yml',
  'docker/entrypoint.sh'
];

const TRACKED_PREFIXES = [
  'config/personas/',
  'config/skills/',
  'config/templates/personas/',
  'config/profiles/'
];

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel, acc);
    else if (entry.isFile() && entry.name !== 'node_modules') acc.push(rel);
  }
  return acc;
}

test('Installer Parity: every shipped config file is provisioned by the installer', () => {
  const installScript = fs.readFileSync(path.join(ROOT, 'install_dsh.sh'), 'utf8');
  const manifest = new Set(
    [...installScript.matchAll(/^fetch_or_copy_file "([^"]+)"$/gm)].map(m => m[1])
  );

  const expected = [
    ...REQUIRED_TOP_LEVEL,
    ...TRACKED_PREFIXES.flatMap(prefix => walk(prefix.replace(/\/$/, '')))
  ].filter(f => !HEREDOC_PROVISIONED.has(f));

  const missing = expected.filter(f => !manifest.has(f));
  assert.deepEqual(missing, [], `install_dsh.sh does not provision: ${missing.join(', ')}`);

  const stale = [...manifest].filter(f => !fs.existsSync(path.join(ROOT, f)));
  assert.deepEqual(stale, [], `install_dsh.sh provisions files that no longer exist: ${stale.join(', ')}`);
});

test('Installer Parity: reset.sh and settings.yaml are provisioned', () => {
  const installScript = fs.readFileSync(path.join(ROOT, 'install_dsh.sh'), 'utf8');
  assert.match(installScript, /fetch_or_copy_file "reset\.sh"/);
  assert.match(installScript, /fetch_or_copy_file "config\/settings\.yaml"/);
  assert.match(installScript, /fetch_or_copy_file "config\/profiles\/web\/pnpm-lock\.yaml"/);
});

test('Installer Parity: provisioning failures abort the install', () => {
  const installScript = fs.readFileSync(path.join(ROOT, 'install_dsh.sh'), 'utf8');
  assert.match(installScript, /PROVISION_FAILURES=\$\(\(PROVISION_FAILURES \+ 1\)\)/);
  assert.match(installScript, /if \[ "\$PROVISION_FAILURES" -gt 0 \]; then/);
});
