import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const SCRIPT_PATH = path.join(ROOT, 'scripts/export_telemetry.sh');

test('export_telemetry.sh: packages trace files and computes SHA-256 manifest', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-export-test-'));
  const phoenixDir = path.join(tmpDir, 'phoenix');
  const archiveDir = path.join(tmpDir, 'archives');
  const extractDir = path.join(tmpDir, 'extracted');

  fs.mkdirSync(phoenixDir, { recursive: true });
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.mkdirSync(extractDir, { recursive: true });

  // Create mock telemetry files
  fs.writeFileSync(path.join(phoenixDir, 'traces.parquet'), 'PARQUET_MOCK_DATA');
  fs.writeFileSync(path.join(phoenixDir, 'phoenix.db'), 'SQLITE_MOCK_DATA');
  fs.writeFileSync(path.join(phoenixDir, 'evals.jsonl'), '{"score": 1.0}\n');

  // Execute export script
  const stdout = execFileSync('bash', [SCRIPT_PATH], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PHOENIX_DIR: phoenixDir,
      ARCHIVE_OUT_DIR: archiveDir
    }
  });

  assert.ok(stdout.includes('Telemetry archive created successfully'), 'Script must report success');

  // Verify archive created
  const archives = fs.readdirSync(archiveDir).filter(f => f.endsWith('.tar.gz'));
  assert.equal(archives.length, 1, 'Exactly one archive must be produced');

  const archiveFile = path.join(archiveDir, archives[0]);

  // Extract archive to verify contents
  execFileSync('tar', ['-xzf', archiveFile, '-C', extractDir]);

  assert.ok(fs.existsSync(path.join(extractDir, 'manifest.sha256')), 'Manifest must exist in archive');
  assert.ok(fs.existsSync(path.join(extractDir, 'data/traces.parquet')), 'Parquet trace must exist in archive');
  assert.ok(fs.existsSync(path.join(extractDir, 'data/phoenix.db')), 'SQLite database must exist in archive');
  assert.ok(fs.existsSync(path.join(extractDir, 'data/evals.jsonl')), 'JSONL evals must exist in archive');

  // Verify manifest contents
  const manifest = fs.readFileSync(path.join(extractDir, 'manifest.sha256'), 'utf8');
  assert.ok(manifest.includes('traces.parquet'), 'Manifest must record traces.parquet');
  assert.ok(manifest.includes('phoenix.db'), 'Manifest must record phoenix.db');
  assert.ok(manifest.includes('evals.jsonl'), 'Manifest must record evals.jsonl');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('export_telemetry.sh: handles empty directory cleanly without error', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-export-empty-'));
  const phoenixDir = path.join(tmpDir, 'empty_phoenix');
  fs.mkdirSync(phoenixDir, { recursive: true });

  const stdout = execFileSync('bash', [SCRIPT_PATH], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PHOENIX_DIR: phoenixDir,
      ARCHIVE_OUT_DIR: path.join(tmpDir, 'archives')
    }
  });

  assert.ok(stdout.includes('No telemetry trace files found'), 'Script must cleanly exit when empty');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
