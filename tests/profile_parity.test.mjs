import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';

const ROOT = path.resolve(import.meta.dirname, '..');
const PROFILES = ['web', 'headless', 'cli'];
const jsTag = {
  tag: 'tag:yaml.org,2002:js',
  resolve: (value) => value
};

function readProfilePatch(profile) {
  const patchPath = path.join(ROOT, 'config', 'profiles', profile, 'cordis.patch.yml');
  assert.ok(fs.existsSync(patchPath), `${profile} must provide cordis.patch.yml`);
  const document = yaml.parse(fs.readFileSync(patchPath, 'utf8'), { customTags: [jsTag] });
  assert.ok(Array.isArray(document), `${profile} cordis.patch.yml must contain a patch array`);
  return document;
}

function coreInsertions(patch) {
  return patch
    .flatMap((entry) => Array.isArray(entry?.insert) ? entry.insert : [])
    .filter((entry) => entry?.id === 'dsh-dds-core' || entry?.name === '@dsh-dds/core');
}

test('Profile parity: every shipped profile enables the native RBAC enforcement plugin', () => {
  for (const profile of PROFILES) {
    const insertions = coreInsertions(readProfilePatch(profile));
    assert.equal(insertions.length, 1, `${profile} must insert @dsh-dds/core exactly once`);
    assert.equal(insertions[0].id, 'dsh-dds-core', `${profile} must use the stable core plugin id`);
    assert.equal(insertions[0].name, '@dsh-dds/core', `${profile} must load the native core plugin`);
    assert.equal(insertions[0].config?.enableToolRbac, true, `${profile} must explicitly enable tool RBAC`);
  }
});

test('Profile parity: container image copies every patch and exposes core to every profile', () => {
  const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');

  for (const profile of PROFILES) {
    assert.match(
      dockerfile,
      new RegExp(`COPY config/profiles/${profile}/cordis\\.patch\\.yml /var/lib/dsh/profiles/${profile}/cordis\\.patch\\.yml`),
      `Dockerfile must install the ${profile} patch`
    );
    assert.match(
      dockerfile,
      new RegExp(`/var/lib/dsh/profiles/${profile}/node_modules/@dsh-dds/core`),
      `Dockerfile must expose @dsh-dds/core to the ${profile} profile`
    );
  }
});

test('Profile parity: standalone installer provisions every profile patch', () => {
  const installer = fs.readFileSync(path.join(ROOT, 'install_dsh.sh'), 'utf8');
  assert.match(
    installer,
    /cat << 'EOF' > "\$DSH_INSTALL\/config\/profiles\/web\/cordis\.patch\.yml"/,
    'installer must embed the canonical web patch'
  );
  for (const profile of ['headless', 'cli']) {
    assert.match(
      installer,
      new RegExp(`fetch_or_copy_file \"config/profiles/${profile}/cordis\\.patch\\.yml\"`),
      `installer must provision the ${profile} patch`
    );
  }
});
