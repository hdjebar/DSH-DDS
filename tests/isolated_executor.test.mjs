import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import yaml from 'yaml';
import { deriveUserPartitionId } from '../packages/dsh-dds-core/iam.js';
import {
  getCurrentExecutionCapability,
  issueExecutionCapability,
  runWithExecutionCapability,
  verifyExecutionCapability
} from '../packages/dsh-dds-core/execution-capability.js';
import { authorizeExecutionRequest, createExecutorServer, validateWorkspaceClaim } from '../services/isolated-executor/server.mjs';
import { enforceRbacPolicy } from '../config/rbac-policy.mjs';
import { registerRbacInterceptor } from '../packages/dsh-dds-core/rbac-interceptor.js';
import { prepareExecutorWorkspaces } from '../scripts/prepare_executor_workspaces.mjs';

const CAPABILITY_KEY = 'executor-test-key-that-is-longer-than-thirty-two-bytes';

function withEnv(values, callback) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  try { return callback(); }
  finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('execution capabilities are short-lived, workdir-bound, and tamper evident', () => withEnv({
  DSH_EXECUTOR_CAPABILITY_KEY: CAPABILITY_KEY
}, () => {
  const user = { id: 'alice', issuer: 'idp', roles: ['user'] };
  const workdir = `/workspaces/users/${deriveUserPartitionId('alice', 'idp')}`;
  const token = issueExecutionCapability({ user, workdir, now: 1_000, ttlMs: 5_000 });
  const claims = verifyExecutionCapability(token, { workdir, now: 2_000 });
  assert.equal(claims.sub, 'alice');
  assert.equal(claims.partition, deriveUserPartitionId('alice', 'idp'));
  assert.throws(() => verifyExecutionCapability(token, { workdir: '/workspaces/shared', now: 2_000 }), /does not authorize/);
  assert.throws(() => verifyExecutionCapability(`${token.slice(0, -1)}x`, { workdir, now: 2_000 }), /signature/);
  assert.throws(() => verifyExecutionCapability(token, { workdir, now: 7_000 }), /Expired/);
}));

test('execution capability context is async-local and disappears after the authorized call', async () => {
  assert.equal(getCurrentExecutionCapability(), null);
  await runWithExecutionCapability('one-time-token', async () => {
    await Promise.resolve();
    assert.equal(getCurrentExecutionCapability(), 'one-time-token');
  });
  assert.equal(getCurrentExecutionCapability(), null);
});

test('executor accepts only the signed tenant root, shared root, or admin cases root', () => {
  const partition = deriveUserPartitionId('alice', 'idp');
  const realpath = value => path.resolve(value);
  const own = validateWorkspaceClaim(`/workspaces/users/${partition}/project`, { partition, roles: ['user'] }, realpath);
  assert.equal(own.root, `/workspaces/users/${partition}`);
  assert.equal(own.writable, true);
  assert.equal(validateWorkspaceClaim('/workspaces/shared/catalog', { partition, roles: ['user'] }, realpath).writable, false);
  assert.throws(
    () => validateWorkspaceClaim('/workspaces/users/u2_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', { partition, roles: ['user'] }, realpath),
    /outside/
  );
  assert.throws(() => validateWorkspaceClaim('/workspaces/cases', { partition, roles: ['user'] }, realpath), /outside/);
  assert.equal(validateWorkspaceClaim('/workspaces/cases', { partition, roles: ['admin'] }, realpath).writable, true);
});

test('isolated mode authorizes shell policy without opening the legacy unconfined gate', () => withEnv({
  DSH_EXECUTOR_MODE: 'isolated',
  DSH_ALLOW_UNCONFINED_SHELL: '0',
  DSH_SANDBOX: '1'
}, () => {
  const persona = {
    name: 'data-analyst',
    rbac: { role: 'data-analyst', permissions: { tools: ['run_shell'], filesystem: { read: ['/workspaces'], write: ['/workspaces'] } } }
  };
  const decision = enforceRbacPolicy(persona, {
    action: 'run_shell',
    target: '/workspaces/users/example',
    workdir: '/workspaces/users/example',
    command: 'pwd'
  });
  assert.equal(decision.allowed, true);
}));

test('PEP exposes a signed execution capability only while the authorized tool runs', async () => {
  const previousMode = process.env.DSH_EXECUTOR_MODE;
  const previousKey = process.env.DSH_EXECUTOR_CAPABILITY_KEY;
  process.env.DSH_EXECUTOR_MODE = 'isolated';
  process.env.DSH_EXECUTOR_CAPABILITY_KEY = CAPABILITY_KEY;
  const handlers = new Map();
  const partition = deriveUserPartitionId('alice', 'idp');
  const workdir = `/workspaces/users/${partition}`;
  const user = { id: 'alice', issuer: 'idp', roles: ['user'] };
  const engine = {
    enforceRbacPolicy: () => ({ allowed: true, role: 'user' }),
    logGrcAuditEvent: () => {}
  };
  const ctx = { on: (name, handler) => handlers.set(name, handler) };
  registerRbacInterceptor(ctx, { enableToolRbac: true, authEnabled: true, rbacEngine: engine });
  try {
    const result = await handlers.get('tools/pre-execute')({
      name: 'bash',
      arguments: { command: 'pwd', workdir },
      user
    }, async () => {
      const token = getCurrentExecutionCapability();
      assert.ok(token);
      assert.equal(verifyExecutionCapability(token, { workdir }).sub, 'alice');
      await Promise.resolve();
      assert.equal(getCurrentExecutionCapability(), token);
      return { kind: 'allow' };
    });
    assert.deepEqual(result, { kind: 'allow' });
    assert.equal(getCurrentExecutionCapability(), null);
  } finally {
    if (previousMode === undefined) delete process.env.DSH_EXECUTOR_MODE;
    else process.env.DSH_EXECUTOR_MODE = previousMode;
    if (previousKey === undefined) delete process.env.DSH_EXECUTOR_CAPABILITY_KEY;
    else process.env.DSH_EXECUTOR_CAPABILITY_KEY = previousKey;
  }
});

test('Compose isolates the executor network and excludes application state mounts', () => {
  const compose = yaml.parse(fs.readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8'));
  const executor = compose.services['isolated-executor'];
  assert.equal(executor.network_mode, 'none');
  assert.match(executor.user, /^11000:/);
  assert.deepEqual(executor.cap_drop, ['ALL']);
  assert.deepEqual(executor.cap_add, ['SYS_ADMIN']);
  assert.equal(executor.read_only, true);
  assert.equal(executor.pids_limit, 64);
  assert.ok(executor.environment.includes('DSH_EXECUTOR_MAX_CONCURRENT=1'));
  assert.ok(executor.volumes.includes('./workspaces/users:/workspaces/users:rw'));
  assert.ok(executor.volumes.every(value => !/audit|storages|sessions|docker\.sock/.test(String(value))));
  const executorSource = fs.readFileSync(new URL('../services/isolated-executor/server.mjs', import.meta.url), 'utf8');
  assert.match(executorSource, /processIsolation, '--user', '--map-root-user', '--pid', '--fork', '--kill-child=SIGKILL'[\s\S]*\.\.\.limitedArgv/);
  assert.match(executorSource, /const limitedArgv = \[\s*confinement\.launcher/);
  assert.doesNotMatch(executorSource, /--mount-proc/);
  assert.match(executorSource, /isolated executor namespace\/Landlock probe failed/);
  const dockerfile = fs.readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /util-linux/);
  assert.match(
    dockerfile,
    /FROM runner AS isolated-executor[\s\S]*ENTRYPOINT \["node", "\/app\/services\/isolated-executor\/server\.mjs"\][\s\S]*FROM runner AS application\s*$/,
    'default Docker build output must remain the DSH application, not the executor target'
  );
});

test('workspace permission migration changes only executor-mounted roots and skips symlinks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-executor-permissions-'));
  try {
    const users = path.join(root, 'users', 'tenant');
    const state = path.join(root, 'state', 'vault');
    fs.mkdirSync(users, { recursive: true, mode: 0o700 });
    fs.mkdirSync(state, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(users, 'report.txt'), 'data', { mode: 0o600 });
    fs.symlinkSync(state, path.join(users, 'state-link'));
    const beforeState = fs.statSync(state).mode & 0o777;
    const report = prepareExecutorWorkspaces({ workspaceRoot: root, gid: process.getgid(), apply: true });
    assert.equal(fs.statSync(users).mode & 0o777, 0o770);
    assert.equal(fs.statSync(path.join(users, 'report.txt')).mode & 0o777, 0o660);
    assert.equal(fs.statSync(state).mode & 0o777, beforeState);
    assert.deepEqual(report.skippedSymlinks, [path.join(users, 'state-link')]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('executor service authenticates a capability and rejects its replay', () => {
  const previousKey = process.env.DSH_EXECUTOR_CAPABILITY_KEY;
  process.env.DSH_EXECUTOR_CAPABILITY_KEY = CAPABILITY_KEY;
  const workdir = `/workspaces/users/${deriveUserPartitionId('alice', 'idp')}`;
  const capability = issueExecutionCapability({ user: { id: 'alice', issuer: 'idp', roles: ['user'] }, workdir });
  try {
    const payload = { capability, command: 'pwd', workdir };
    const accepted = authorizeExecutionRequest(payload, value => ({ workdir: value, root: value, writable: true }));
    assert.equal(accepted.claims.sub, 'alice');
    assert.equal(accepted.workspace.workdir, workdir);
    assert.throws(
      () => authorizeExecutionRequest(payload, value => ({ workdir: value, root: value, writable: true })),
      /already been used/
    );
  } finally {
    if (previousKey === undefined) delete process.env.DSH_EXECUTOR_CAPABILITY_KEY;
    else process.env.DSH_EXECUTOR_CAPABILITY_KEY = previousKey;
  }
});

test('executor cancels a running command when the client socket closes', async () => {
  const previousKey = process.env.DSH_EXECUTOR_CAPABILITY_KEY;
  process.env.DSH_EXECUTOR_CAPABILITY_KEY = CAPABILITY_KEY;
  const workdir = `/workspaces/users/${deriveUserPartitionId('cancel-probe', 'idp')}`;
  let signalAborted;
  const aborted = new Promise(resolve => { signalAborted = resolve; });
  const server = createExecutorServer({
    launcher: '/unused',
    grantArgs: () => [],
    enforcement: 'full',
    validateWorkspace: value => ({ workdir: value, root: value, writable: true }),
    execute: (_payload, confinement) => new Promise(resolve => {
      confinement.signal.addEventListener('abort', () => {
        signalAborted();
        resolve({ aborted: true });
      }, { once: true });
    })
  });
  const socketPath = path.join(os.tmpdir(), `dsh-executor-test-${process.pid}-${Date.now()}.sock`);
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    const capability = issueExecutionCapability({
      user: { id: 'cancel-probe', issuer: 'idp', roles: ['user'] },
      workdir
    });
    const req = http.request({
      socketPath,
      path: '/v1/execute',
      method: 'POST'
    });
    req.on('error', () => {});
    req.end(JSON.stringify({ capability, command: 'sleep 60', workdir }));
    await new Promise(resolve => setTimeout(resolve, 20));
    req.destroy();
    await Promise.race([
      aborted,
      new Promise((_, reject) => setTimeout(() => reject(new Error('executor abort signal was not delivered')), 1_000))
    ]);
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (previousKey === undefined) delete process.env.DSH_EXECUTOR_CAPABILITY_KEY;
    else process.env.DSH_EXECUTOR_CAPABILITY_KEY = previousKey;
  }
});
