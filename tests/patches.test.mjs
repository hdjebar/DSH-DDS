import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const PATCH_SCRIPT = path.join(ROOT, 'config', 'patch-pi-ai.mjs');

const MOCK_PI_AI_TEMPLATE = 'function handleCompletions() {\n'
  + '    const name = toolCall.function?.name ?? toolCall.custom?.name;\n'
  + '    return {\n'
  + '                        id: tc.id,\n'
  + '        name: name\n'
  + '    };\n'
  + '}\n';

test('Patch Verification: patch-pi-ai applies thought_signature bridge cleanly', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-patch-test-'));
  const mockFile = path.join(tmpDir, 'openai-completions.js');
  fs.writeFileSync(mockFile, MOCK_PI_AI_TEMPLATE, 'utf8');

  try {
    const output = execFileSync(process.execPath, [PATCH_SCRIPT], {
      env: { ...process.env, PI_AI_COMPLETIONS_FILE: mockFile },
      encoding: 'utf8'
    });

    assert.ok(output.includes('Applied Google thought_signature bridge patch cleanly'));

    const patchedContent = fs.readFileSync(mockFile, 'utf8');
    assert.ok(patchedContent.includes('const googleExtraContentCache = new Map();'));
    assert.ok(patchedContent.includes('googleExtraContentCache.set('));
    assert.ok(patchedContent.includes('extra_content: extra'));

    // Test Idempotency
    const secondOutput = execFileSync(process.execPath, [PATCH_SCRIPT], {
      env: { ...process.env, PI_AI_COMPLETIONS_FILE: mockFile },
      encoding: 'utf8'
    });
    assert.ok(secondOutput.includes('already applied; nothing to do'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Patch Verification: patch-pi-ai fails fast when upstream anchors deviate', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-patch-fail-'));
  const brokenMockFile = path.join(tmpDir, 'openai-completions.js');
  fs.writeFileSync(brokenMockFile, 'function upstreamChanged() { return true; }', 'utf8');

  try {
    assert.throws(() => {
      execFileSync(process.execPath, [PATCH_SCRIPT], {
        env: { ...process.env, PI_AI_COMPLETIONS_FILE: brokenMockFile },
        encoding: 'utf8',
        stdio: 'pipe'
      });
    }, /Command failed/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

const BASH_LOCAL_PATCH = path.join(ROOT, 'config', 'patch-bash-local.mjs');

test('Patch Verification: patch-bash-local applies auto-workdir patch cleanly and idempotently', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-bash-patch-test-'));
  const mockFile = path.join(tmpDir, 'index.js');
  fs.writeFileSync(mockFile, 'import z from "foo";\n\tspawnSpec(spec, argv, stdoutMaxBytes, signal) {\n  return true;\n}\n', 'utf8');

  try {
    const output = execFileSync(process.execPath, [BASH_LOCAL_PATCH], {
      env: { ...process.env, DSH_BASH_LOCAL_FILE: mockFile },
      encoding: 'utf8'
    });
    assert.ok(output.includes('applied cleanly'));

    const patched = fs.readFileSync(mockFile, 'utf8');
    assert.ok(patched.includes('import { existsSync, mkdirSync } from "node:fs";'));
    assert.ok(patched.includes('mkdirSync(spec.workdir'));

    // Idempotency
    const secondOutput = execFileSync(process.execPath, [BASH_LOCAL_PATCH], {
      env: { ...process.env, DSH_BASH_LOCAL_FILE: mockFile },
      encoding: 'utf8'
    });
    assert.ok(secondOutput.includes('already applied'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

const CLIENT_CONN_PATCH = path.join(ROOT, 'config', 'patch-client-connection.mjs');

test('Patch Verification: patch-client-connection eliminates 401 token fence cleanly and idempotently', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-conn-patch-test-'));
  const mockFile = path.join(tmpDir, 'index.js');
  const mockContent = 'if (req.method === "GET" && url.pathname === "/" && tokens.length === 1 && authority !== void 0 && tokenMatches(tokens.join(""), this.launchToken)) {\n'
    + '\t\tif (this.isAuthenticated(req)) return true;\n\t\tthis.writeUnauthorized(req, res);\n\t\treturn false;\n'
    + '\trequestRejection(request) {\n\t\tif (!isTrustedApiRequest(request, this.trustedHosts)) return 403;\n\t\treturn this.browserAuth.isAuthenticated(request) ? void 0 : 401;\n\t}\n';
  fs.writeFileSync(mockFile, mockContent, 'utf8');

  try {
    const output = execFileSync(process.execPath, [CLIENT_CONN_PATCH], {
      env: { ...process.env, DSH_CLIENT_CONNECTION_FILE: mockFile },
      encoding: 'utf8'
    });
    assert.ok(output.includes('applied cleanly'));

    const patched = fs.readFileSync(mockFile, 'utf8');
    assert.ok(patched.includes('token fence bypass applied'));
    assert.ok(patched.includes('sessionCookie(cookieName(authority)'));
    assert.ok(!patched.includes('this.writeUnauthorized(req, res)'));

    // Idempotency
    const secondOutput = execFileSync(process.execPath, [CLIENT_CONN_PATCH], {
      env: { ...process.env, DSH_CLIENT_CONNECTION_FILE: mockFile },
      encoding: 'utf8'
    });
    assert.ok(secondOutput.includes('already applied'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
