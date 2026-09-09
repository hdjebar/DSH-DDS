import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import {
  assertExecutionCapabilityKey,
  verifyExecutionCapability
} from '../../packages/dsh-dds-core/execution-capability.js';

const SOCKET_PATH = process.env.DSH_EXECUTOR_SOCKET || '/run/dsh-executor/executor.sock';
const MAX_REQUEST_BYTES = 128 * 1024;
const MAX_COMMAND_BYTES = 32 * 1024;
const MAX_STDIN_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_TIMEOUT_MS = 120_000;
const ALLOWED_ENV = new Set(['LANG', 'LC_ALL', 'TERM', 'TZ', 'DSH_SESSION_ID', 'DSH_TRACE_ID', 'DSH_WORKSPACE']);
const usedNonces = new Map();

function inside(target, root) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function validateWorkspaceClaim(workdir, claims, realpath = fs.realpathSync) {
  if (typeof workdir !== 'string' || !path.isAbsolute(workdir)) throw new Error('workdir must be absolute');
  const requested = path.resolve(workdir);
  const userRoot = `/workspaces/users/${claims.partition}`;
  const sharedRoot = '/workspaces/shared';
  const casesRoot = '/workspaces/cases';
  let declaredRoot;
  let writable = true;
  if (inside(requested, userRoot)) declaredRoot = userRoot;
  else if (inside(requested, sharedRoot)) {
    declaredRoot = sharedRoot;
    writable = false;
  } else if (Array.isArray(claims.roles) && claims.roles.includes('admin') && inside(requested, casesRoot)) {
    declaredRoot = casesRoot;
  } else {
    throw new Error('capability workdir is outside an executor-mounted workspace');
  }
  const canonicalRoot = realpath(declaredRoot);
  const canonicalWorkdir = realpath(requested);
  if (!inside(canonicalWorkdir, canonicalRoot)) throw new Error('workdir resolves outside its authorized workspace');
  return { workdir: canonicalWorkdir, root: canonicalRoot, writable };
}

export function provisionAndValidateWorkspaceClaim(workdir, claims) {
  const requested = path.resolve(workdir);
  const usersBase = '/workspaces/users';
  const userRoot = path.join(usersBase, claims.partition);
  if (!inside(requested, userRoot)) return validateWorkspaceClaim(workdir, claims);
  if (!/^u2_[A-Za-z0-9_-]{20,}$/.test(claims.partition)) throw new Error('capability partition is invalid');

  const canonicalBase = fs.realpathSync(usersBase);
  if (!fs.existsSync(userRoot)) fs.mkdirSync(userRoot, { mode: 0o770 });
  const rootStat = fs.lstatSync(userRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('tenant workspace root is not a plain directory');
  const canonicalRoot = fs.realpathSync(userRoot);
  if (!inside(canonicalRoot, canonicalBase)) throw new Error('tenant workspace root escapes the users directory');

  if (!fs.existsSync(requested)) {
    let ancestor = path.dirname(requested);
    while (!fs.existsSync(ancestor) && inside(ancestor, canonicalRoot)) ancestor = path.dirname(ancestor);
    const canonicalAncestor = fs.realpathSync(ancestor);
    if (!inside(canonicalAncestor, canonicalRoot)) throw new Error('workspace ancestor escapes the tenant root');
    fs.mkdirSync(requested, { recursive: true, mode: 0o770 });
  }
  return validateWorkspaceClaim(requested, claims);
}

export function authorizeExecutionRequest(payload, validateWorkspace = provisionAndValidateWorkspaceClaim, now = Date.now()) {
  const claims = verifyExecutionCapability(payload.capability, { workdir: payload.workdir, now });
  for (const [nonce, expiry] of usedNonces) if (expiry < now) usedNonces.delete(nonce);
  if (usedNonces.has(claims.nonce)) throw new Error('execution capability has already been used');
  usedNonces.set(claims.nonce, claims.exp);
  return { claims, workspace: validateWorkspace(payload.workdir, claims) };
}

function boundedInteger(value, fallback, maximum) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('executor limit must be positive');
  return Math.min(Math.floor(parsed), maximum);
}

function childEnvironment(input = {}, workspace) {
  const env = {
    PATH: '/usr/local/bin:/usr/bin:/bin',
    HOME: workspace,
    TMPDIR: '/tmp',
    LANG: 'C.UTF-8'
  };
  for (const [key, value] of Object.entries(input || {})) {
    if (ALLOWED_ENV.has(key) && typeof value === 'string' && Buffer.byteLength(value) <= 4096) env[key] = value;
  }
  return env;
}

function appendTail(state, chunk, cap) {
  state.total += chunk.length;
  const combined = Buffer.concat([state.tail, chunk]);
  state.tail = combined.length > cap ? combined.subarray(combined.length - cap) : combined;
  if (state.total > cap) state.truncated = true;
}

function terminateGroup(child, signal = 'SIGKILL') {
  if (!child.pid) return;
  try { process.kill(-child.pid, signal); } catch {
    try { child.kill(signal); } catch {}
  }
}

export function executeConfined(payload, confinement) {
  const timeoutMs = boundedInteger(payload.timeoutMs, 60_000, MAX_TIMEOUT_MS);
  const outputCap = boundedInteger(payload.stdoutMaxBytes, 64 * 1024, MAX_OUTPUT_BYTES);
  if (typeof payload.command !== 'string' || !payload.command.trim() || Buffer.byteLength(payload.command) > MAX_COMMAND_BYTES) {
    throw new Error('command is empty or exceeds the command limit');
  }
  if (payload.stdin !== undefined && (typeof payload.stdin !== 'string' || Buffer.byteLength(payload.stdin) > MAX_STDIN_BYTES)) {
    throw new Error('stdin exceeds the executor limit');
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-exec-'));
  const cpuSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  const limitedArgv = [
    '/usr/bin/prlimit', '--nproc=32:32', '--nofile=128:128',
    '--fsize=16777216:16777216', `--cpu=${cpuSeconds}:${cpuSeconds}`, '--',
    '/bin/bash', '-c', payload.command
  ];
  const grants = {
    readOnly: ['/usr', '/bin', '/lib', '/lib64', '/etc/ld.so.cache', '/dev/null'].filter(candidate => fs.existsSync(candidate)),
    readWrite: [tempDir]
  };
  if (confinement.writable) grants.readWrite.push(confinement.root);
  else grants.readOnly.push(confinement.root);
  const argv = [confinement.launcher, ...confinement.grantArgs(grants), '--', ...limitedArgv];

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const stdout = { total: 0, tail: Buffer.alloc(0), truncated: false };
    const stderr = { total: 0, tail: Buffer.alloc(0), truncated: false };
    let timedOut = false;
    let aborted = false;
    let outputLimitHit = false;
    let settled = false;
    const child = spawn(argv[0], argv.slice(1), {
      cwd: confinement.workdir,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnvironment(payload.env, confinement.workdir)
    });
    const timer = setTimeout(() => {
      timedOut = true;
      terminateGroup(child, 'SIGTERM');
      setTimeout(() => terminateGroup(child), 1000).unref();
    }, timeoutMs);
    const abortExecution = () => {
      if (settled) return;
      aborted = true;
      terminateGroup(child, 'SIGTERM');
      setTimeout(() => terminateGroup(child), 1000).unref();
    };
    confinement.signal?.addEventListener('abort', abortExecution, { once: true });
    const onData = (state, chunk) => {
      appendTail(state, chunk, outputCap);
      if (!outputLimitHit && (stdout.total + stderr.total > outputCap * 2)) {
        outputLimitHit = true;
        terminateGroup(child);
      }
    };
    child.stdout.on('data', chunk => onData(stdout, chunk));
    child.stderr.on('data', chunk => onData(stderr, chunk));
    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      confinement.signal?.removeEventListener('abort', abortExecution);
      fs.rmSync(tempDir, { recursive: true, force: true });
      reject(error);
    });
    child.on('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      confinement.signal?.removeEventListener('abort', abortExecution);
      fs.rmSync(tempDir, { recursive: true, force: true });
      resolve({
        exitCode,
        signal,
        timedOut,
        aborted,
        timeoutMs,
        stdout: { text: stdout.tail.toString('utf8'), truncated: stdout.truncated },
        stderr: {
          text: stderr.tail.toString('utf8') + (outputLimitHit ? '\n[executor output limit exceeded]' : ''),
          truncated: stderr.truncated
        },
        sandbox: { mode: 'workspace-write', denied: false, enforcement: confinement.enforcement },
        durationMs: Date.now() - startedAt
      });
    });
    if (payload.stdin !== undefined) child.stdin.end(payload.stdin);
    else child.stdin.end();
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        reject(new Error('request body exceeds executor limit'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('request body must be valid JSON')); }
    });
    req.on('error', reject);
  });
}

export function createExecutorServer({
  launcher,
  grantArgs,
  enforcement,
  execute = executeConfined,
  validateWorkspace = validateWorkspaceClaim,
  maxConcurrent = 1
}) {
  let active = 0;
  return http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.method !== 'POST' || req.url !== '/v1/execute') {
      res.writeHead(404).end(JSON.stringify({ error: 'not found' }));
      return;
    }
    if (active >= maxConcurrent) {
      res.writeHead(429).end(JSON.stringify({ error: 'executor concurrency limit reached' }));
      return;
    }
    active += 1;
    try {
      const payload = await readJson(req);
      const { workspace } = authorizeExecutionRequest(payload, validateWorkspace);
      const controller = new AbortController();
      const cancel = () => controller.abort();
      res.once('close', cancel);
      const result = await execute(payload, { ...workspace, launcher, grantArgs, enforcement, signal: controller.signal });
      res.removeListener('close', cancel);
      res.writeHead(200).end(JSON.stringify(result));
    } catch (error) {
      if (!res.headersSent) res.writeHead(403);
      if (!res.writableEnded) res.end(JSON.stringify({ error: error.message || 'execution rejected' }));
    } finally {
      active -= 1;
    }
  });
}

async function main() {
  assertExecutionCapabilityKey();
  const requireFromDsh = createRequire('/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json');
  const addonEntry = requireFromDsh.resolve('@deepseek-ai/node-addon-landlock-run');
  const addon = await import(pathToFileURL(addonEntry).href);
  const launcher = addon.launcherPath();
  const enforcement = addon.probe(launcher, { timeoutMs: 2_000 });
  if (enforcement !== 'full') {
    throw new Error(`Landlock enforcement is ${enforcement}; isolated executor requires full enforcement`);
  }
  const socketDir = path.dirname(SOCKET_PATH);
  fs.mkdirSync(socketDir, { recursive: true, mode: 0o770 });
  try {
    const stat = fs.lstatSync(SOCKET_PATH);
    if (!stat.isSocket()) throw new Error(`Refusing to replace non-socket path ${SOCKET_PATH}`);
    fs.unlinkSync(SOCKET_PATH);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const server = createExecutorServer({
    launcher,
    grantArgs: addon.grantArgs,
    enforcement,
    maxConcurrent: boundedInteger(process.env.DSH_EXECUTOR_MAX_CONCURRENT, 1, 1)
  });
  server.listen(SOCKET_PATH, () => fs.chmodSync(SOCKET_PATH, 0o660));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`isolated-executor: ${error.message}\n`);
    process.exitCode = 1;
  });
}
