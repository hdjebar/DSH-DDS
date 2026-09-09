import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {
  DEFAULT_OPERATOR,
  extractUserFromHeaders,
  verifyBearerToken,
  IamService,
  UserPartitionManager,
  ByokVault,
  encryptSecret,
  decryptSecret,
  handleVaultApiRequest,
  registerRbacInterceptor,
  registerGatewayMiddleware,
  deriveUserPartitionId,
  legacyUserPartitionId
} from '../packages/dsh-dds-core/index.js';
import { EventEmitter } from 'node:events';

const TEST_AUDIT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-multi-user-audit-'));
process.env.DSH_AUDIT_LOG_FILE = path.join(TEST_AUDIT_ROOT, 'audit_grc.jsonl');
process.env.DSH_AUDIT_INTEGRITY_KEY = 'multi-user-test-audit-integrity-key-32-bytes';
test.after(() => fs.rmSync(TEST_AUDIT_ROOT, { recursive: true, force: true }));

test('IAM Service: default fallback when unauthenticated in single-operator mode', () => {
  const result = extractUserFromHeaders({}, { authEnabled: false });
  assert.equal(result.id, 'default');
  assert.match(result.partitionId, /^u2_[A-Za-z0-9_-]{43}$/);
  assert.equal(result.name, 'Default Operator');
  assert.deepEqual(result.roles, ['admin']);
  assert.deepEqual(result.permissions, ['*']);
});

test('IAM Service: extracts user identity from custom gateway headers only from trusted peer', () => {
  const headers = {
    'x-dsh-user-id': 'alice_99',
    'x-dsh-user-name': 'Alice Analyst',
    'x-dsh-user-roles': 'data-analyst, researcher'
  };

  // Untrusted peer or trustProxyHeaders disabled -> Headers ignored, safe default returned
  const untrustedResult = extractUserFromHeaders(headers, { authEnabled: false, trustProxyHeaders: false });
  assert.equal(untrustedResult.id, 'default');
  assert.deepEqual(untrustedResult.roles, ['admin']);

  const untrustedIp = extractUserFromHeaders(headers, { authEnabled: false, trustProxyHeaders: true, remoteAddress: '198.51.100.4' });
  assert.equal(untrustedIp.id, 'default');

  // Trusted gateway with trustProxyHeaders enabled -> Successfully extracts user identity
  const result = extractUserFromHeaders(headers, { authEnabled: false, trustProxyHeaders: true, remoteAddress: '127.0.0.1' });
  assert.equal(result.id, 'alice_99');
  assert.equal(result.issuer, 'dsh-gateway');
  assert.equal(result.name, 'Alice Analyst');
  assert.deepEqual(result.roles, ['data-analyst', 'researcher']);
  assert.deepEqual(result.permissions, ['workspace:read', 'workspace:write']);
});

test('IAM Service: enforces bearer token validation when auth is enabled', () => {
  const secret = 'super-secret-auth-key-32-bytes-long!';
  
  // Unauthenticated request fails
  const unauth = extractUserFromHeaders({}, { authEnabled: true, authSecret: secret });
  assert.equal(unauth.error, 'UNAUTHORIZED');

  // Create valid signed token: header.payload.signature
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'bob_sec',
    name: 'Bob Auditor',
    roles: ['security-auditor'],
    exp: Math.floor(Date.now() / 1000) + 3600
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  const token = `${header}.${payload}.${signature}`;

  const authed = extractUserFromHeaders({ authorization: `Bearer ${token}` }, { authEnabled: true, authSecret: secret });
  assert.equal(authed.id, 'bob_sec');
  assert.equal(authed.issuer, 'dsh-local');
  assert.equal(authed.name, 'Bob Auditor');
  assert.deepEqual(authed.roles, ['security-auditor']);

  // Tampered signature fails
  const tamperedToken = `${header}.${payload}.invalid_signature`;
  const tampered = extractUserFromHeaders({ authorization: `Bearer ${tamperedToken}` }, { authEnabled: true, authSecret: secret });
  assert.equal(tampered.error, 'UNAUTHORIZED');
});

test('UserPartitionManager: generates scoped directories and enforces path boundaries', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-user-partition-'));
  const realTmpDir = fs.realpathSync(tmpDir);
  const userBase = path.join(realTmpDir, 'users');
  const wsBase = path.join(realTmpDir, 'workspaces');

  try {
    const mgr = new UserPartitionManager({ userStateBase: userBase, workspaceBase: wsBase });
    const paths = mgr.getUserPaths('alice');
    assert.equal(paths.userId, deriveUserPartitionId('alice'));
    assert.equal(paths.sessions, path.join(userBase, paths.userId, 'sessions'));
    assert.equal(paths.workspace, path.join(wsBase, 'users', paths.userId));
    assert.equal(paths.sharedWorkspace, path.join(wsBase, 'shared'));

    // Admin user has global access
    const adminCheck = mgr.validatePathAccess(path.join(wsBase, 'users', 'bob', 'file.txt'), { id: 'admin', roles: ['admin'] });
    assert.equal(adminCheck.allowed, true);

    // Alice accessing her own workspace
    const aliceSelf = mgr.validatePathAccess(path.join(paths.workspace, 'data.csv'), { id: 'alice', roles: ['user'] });
    assert.equal(aliceSelf.allowed, true);

    // Alice accessing shared workspace
    const aliceShared = mgr.validatePathAccess(path.join(wsBase, 'shared', 'team.json'), { id: 'alice', roles: ['user'] });
    assert.equal(aliceShared.allowed, true);

    // Alice attempting to access Bob's workspace -> Blocked
    const aliceCross = mgr.validatePathAccess(path.join(wsBase, 'users', 'bob', 'secret.txt'), { id: 'alice', roles: ['user'] });
    assert.equal(aliceCross.allowed, false);
    assert.match(aliceCross.reason, /Multi-tenant violation/);

    // Alice attempting to access outside workspaces -> Blocked
    const aliceEscape = mgr.validatePathAccess('/etc/passwd', { id: 'alice', roles: ['user'] });
    assert.equal(aliceEscape.allowed, false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ByokVault: AES-256-GCM encryption and per-user key management', () => {
  const masterSecret = 'test-master-key-cryptographic-secret-32b';
  const plaintext = 'sk-or-v1-my-secret-openrouter-key';

  // Raw encrypt / decrypt
  const encrypted = encryptSecret(plaintext, masterSecret);
  assert.ok(encrypted.ciphertext);
  assert.ok(encrypted.iv);
  assert.ok(encrypted.tag);
  assert.ok(encrypted.salt);

  const decrypted = decryptSecret(encrypted, masterSecret);
  assert.equal(decrypted, plaintext);

  // Tampered tag throws error
  const tamperedTag = { ...encrypted, tag: Buffer.alloc(16, 0).toString('base64') };
  assert.throws(() => {
    decryptSecret(tamperedTag, masterSecret);
  }, /Unsupported state or unable to authenticate data/);

  // ByokVault instance storage
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-vault-'));
  try {
    const vault = new ByokVault({ masterSecret, userStateBase: tmpDir });
    vault.setApiKey('alice', 'openrouter', plaintext);
    vault.setApiKey('alice', 'gemini', 'AIzaSyFakeGeminiKey');

    const providers = vault.listConfiguredProviders('alice');
    assert.deepEqual(providers.sort(), ['gemini', 'openrouter']);

    const retrieved = vault.getApiKey('alice', 'openrouter');
    assert.equal(retrieved, plaintext);

    // Non-existent key returns null
    assert.equal(vault.getApiKey('alice', 'anthropic'), null);
    assert.equal(vault.getApiKey('bob', 'openrouter'), null);

    // Deletion
    assert.equal(vault.deleteApiKey('alice', 'gemini'), true);
    assert.equal(vault.getApiKey('alice', 'gemini'), null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Identity partitions: v2 IDs are versioned, issuer-bound, case-sensitive, and collision-resistant', () => {
  const oldCollisionSet = [
    'alice@example.com',
    'alice+example.com',
    'alice/example.com'
  ];
  assert.equal(new Set(oldCollisionSet.map(legacyUserPartitionId)).size, 1);
  assert.equal(new Set(oldCollisionSet.map(id => deriveUserPartitionId(id))).size, oldCollisionSet.length);
  assert.notEqual(deriveUserPartitionId('Alice'), deriveUserPartitionId('alice'));
  assert.notEqual(
    deriveUserPartitionId('alice', 'https://idp-a.example'),
    deriveUserPartitionId('alice', 'https://idp-b.example')
  );
  assert.match(deriveUserPartitionId('alice'), /^u2_[A-Za-z0-9_-]{43}$/);
});

test('User partitions: legacy access is explicit and ambiguous migration maps fail closed', () => {
  const alice = { id: 'alice@example.com', issuer: 'legacy-idp' };
  const alicePartition = deriveUserPartitionId(alice.id, alice.issuer);
  const legacyId = legacyUserPartitionId(alice.id);
  const baseOptions = { userStateBase: '/state/users', workspaceBase: '/workspaces' };

  const unmapped = new UserPartitionManager(baseOptions);
  assert.equal(
    unmapped.validatePathAccess(`/workspaces/users/${legacyId}/report.md`, { ...alice, roles: ['user'] }).allowed,
    false
  );

  const mapped = new UserPartitionManager({
    ...baseOptions,
    legacyPartitionMap: { [alicePartition]: legacyId }
  });
  assert.equal(
    mapped.validatePathAccess(`/workspaces/users/${legacyId}/report.md`, { ...alice, roles: ['user'] }).allowed,
    true
  );
  assert.throws(() => new UserPartitionManager({
    ...baseOptions,
    legacyPartitionMap: {
      [alicePartition]: legacyId,
      [deriveUserPartitionId('alice+example.com', alice.issuer)]: legacyId
    }
  }), /Ambiguous legacy partition migration mapping/);
});

test('IAM Service: request identity is immutable and isolated across concurrent async contexts', async () => {
  const iam = new IamService(null, { authEnabled: true });
  const alice = { id: 'alice', issuer: 'idp', roles: ['user'] };
  const bob = { id: 'bob', issuer: 'idp', roles: ['security-auditor'] };
  let releaseAlice;
  const aliceGate = new Promise(resolve => { releaseAlice = resolve; });

  const aliceRequest = iam.runWithUser(alice, async () => {
    assert.equal(iam.getCurrentUser().id, 'alice');
    await aliceGate;
    assert.equal(iam.getCurrentUser().id, 'alice');
    assert.throws(() => { iam.getCurrentUser().roles.push('admin'); }, TypeError);
  });
  const bobRequest = iam.runWithUser(bob, async () => {
    await Promise.resolve();
    assert.equal(iam.getCurrentUser().id, 'bob');
    releaseAlice();
  });

  await Promise.all([aliceRequest, bobRequest]);
  assert.equal(iam.getCurrentUser(), null, 'authenticated mode must not retain a global user');
});

test('In-Line PEP: authenticated mode ignores mutable ctx.user fallback', async () => {
  let beforeHook;
  const mutableCtx = {
    user: { id: 'bob', roles: ['admin'] },
    before(event, fn) {
      if (event === 'tool-execute') beforeHook = fn;
    }
  };
  registerRbacInterceptor(mutableCtx, { enableToolRbac: true, authEnabled: true });
  await assert.rejects(
    beforeHook({ toolName: 'read_file', target: '/workspaces/shared/readme.md' }),
    /Missing authenticated user identity context/
  );
});

test('In-Line PEP: concurrent request contexts keep authorization principals isolated', async () => {
  const iam = new IamService(null, { authEnabled: true });
  let beforeHook;
  const ctx = {
    get(name) { return name === 'iam' ? iam : null; },
    before(event, fn) { if (event === 'tool-execute') beforeHook = fn; }
  };
  const rbacEngine = {
    enforceRbacPolicy() { return { allowed: true, role: 'user' }; },
    logGrcAuditEvent() {}
  };
  registerRbacInterceptor(ctx, {
    enableToolRbac: true,
    authEnabled: true,
    rbacEngine,
    userStateBase: '/state/users',
    workspaceBase: '/workspaces'
  });

  const alice = { id: 'alice', issuer: 'idp', roles: ['user'] };
  const bob = { id: 'bob', issuer: 'idp', roles: ['user'] };
  const aliceWorkspace = `/workspaces/users/${deriveUserPartitionId('alice', 'idp')}`;
  const bobWorkspace = `/workspaces/users/${deriveUserPartitionId('bob', 'idp')}`;

  await Promise.all([
    iam.runWithUser(alice, async () => {
      await Promise.resolve();
      await assert.doesNotReject(beforeHook({ toolName: 'read_file', target: `${aliceWorkspace}/own.txt` }));
      await assert.rejects(
        beforeHook({ toolName: 'read_file', target: `${bobWorkspace}/secret.txt` }),
        /Multi-tenant violation/
      );
    }),
    iam.runWithUser(bob, async () => {
      await Promise.resolve();
      await assert.doesNotReject(beforeHook({ toolName: 'read_file', target: `${bobWorkspace}/own.txt` }));
    })
  ]);
});

test('BYOK Vault: legacy reads require an injective migration manifest and writes copy forward to v2', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-vault-migration-'));
  const masterSecret = 'test-master-key-cryptographic-secret-32b';
  const identity = { id: 'alice@example.com', issuer: 'legacy-idp' };
  const partitionId = deriveUserPartitionId(identity.id, identity.issuer);
  const legacyId = legacyUserPartitionId(identity.id);
  const legacyPath = path.join(tmpDir, legacyId, 'storages', 'vault.enc.json');

  try {
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
    fs.writeFileSync(legacyPath, JSON.stringify({ openrouter: encryptSecret('legacy-secret', masterSecret) }));

    const unmapped = new ByokVault({ masterSecret, userStateBase: tmpDir });
    assert.equal(unmapped.getApiKey(identity, 'openrouter'), null);

    const mapped = new ByokVault({
      masterSecret,
      userStateBase: tmpDir,
      legacyPartitionMap: { [partitionId]: legacyId }
    });
    assert.equal(mapped.getApiKey(identity, 'openrouter'), 'legacy-secret');
    mapped.setApiKey(identity, 'gemini', 'new-secret');
    assert.ok(fs.existsSync(mapped.getVaultPath(identity)));
    assert.ok(fs.existsSync(legacyPath), 'legacy source remains available for rollback');
    assert.equal(mapped.getApiKey(identity, 'openrouter'), 'legacy-secret');

    assert.throws(() => new ByokVault({
      masterSecret,
      userStateBase: tmpDir,
      legacyPartitionMap: {
        [partitionId]: legacyId,
        [deriveUserPartitionId('alice+example.com', identity.issuer)]: legacyId
      }
    }), /Ambiguous legacy vault migration mapping/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('In-Line PEP: enforces multi-tenant workspace confinement during tool execution', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pep-tenant-'));
  const realTmpDir = fs.realpathSync(tmpDir);
  const userBase = path.join(realTmpDir, 'users');
  const wsBase = path.join(realTmpDir, 'workspaces');

  try {
    const handlers = [];
    const fakeCtx = {
      before: (event, fn) => handlers.push(fn),
      user: DEFAULT_OPERATOR
    };

    registerRbacInterceptor(fakeCtx, {
      enableToolRbac: true,
      userStateBase: userBase,
      workspaceBase: wsBase
    });

    assert.equal(handlers.length, 1);
    const interceptor = handlers[0];

    // Alice accessing her own workspace -> Allowed
    await assert.doesNotReject(async () => {
      await interceptor({
        user: { id: 'alice', roles: ['user'] },
        toolName: 'read_file',
        action: 'read_file',
        target: path.join(wsBase, 'users', deriveUserPartitionId('alice'), 'document.txt')
      });
    });

    // Alice accessing shared workspace -> Allowed
    await assert.doesNotReject(async () => {
      await interceptor({
        user: { id: 'alice', roles: ['user'] },
        toolName: 'read_file',
        action: 'read_file',
        target: path.join(wsBase, 'shared', 'readme.txt')
      });
    });

    // Alice attempting to access Bob's workspace -> Blocked by PEP
    await assert.rejects(async () => {
      await interceptor({
        user: { id: 'alice', roles: ['user'] },
        toolName: 'read_file',
        action: 'read_file',
        target: path.join(wsBase, 'users', 'bob', 'secret.txt')
      });
    }, /Zero-Trust RBAC Violation.*Multi-tenant violation/);

    // Admin accessing Bob's workspace -> Allowed
    await assert.doesNotReject(async () => {
      await interceptor({
        user: { id: 'admin', roles: ['admin'] },
        toolName: 'read_file',
        action: 'read_file',
        target: path.join(wsBase, 'users', 'bob', 'secret.txt')
      });
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('BYOK Vault HTTP REST API: supports GET, POST, DELETE with JSON payloads', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-vault-api-'));
  try {
    const vault = new ByokVault({ masterSecret: 'test-vault-secret-1234567890123456', userStateBase: tmpDir });
    const user = { id: 'alice', roles: ['user'] };

    const mockRequest = (method, bodyObj, query = '') => {
      const req = new EventEmitter();
      req.method = method;
      req.url = `/dsh-dds/api/vault/keys${query}`;
      req.headers = {};
      const res = {
        statusCode: 0,
        headers: {},
        body: '',
        setHeader(k, v) { this.headers[k] = v; },
        end(data) { this.body = data; this.emit('finish'); }
      };
      Object.assign(res, EventEmitter.prototype);

      process.nextTick(() => {
        if (bodyObj) req.emit('data', JSON.stringify(bodyObj));
        req.emit('end');
      });
      return { req, res };
    };

    // 1. Initial GET -> empty
    const { req: getReq, res: getRes } = mockRequest('GET');
    await handleVaultApiRequest(getReq, getRes, vault, user);
    const getInitial = JSON.parse(getRes.body);
    assert.equal(getInitial.success, true);
    assert.equal(getInitial.count, 0);

    // 2. POST to save key
    const { req: postReq, res: postRes } = mockRequest('POST', { provider: 'openrouter', apiKey: 'sk-or-test-secret' });
    await handleVaultApiRequest(postReq, postRes, vault, user);
    const postData = JSON.parse(postRes.body);
    assert.equal(postData.success, true);
    assert.equal(postData.provider, 'openrouter');

    // 3. GET after saving -> count 1
    const { req: getReq2, res: getRes2 } = mockRequest('GET');
    await handleVaultApiRequest(getReq2, getRes2, vault, user);
    const getAfter = JSON.parse(getRes2.body);
    assert.equal(getAfter.count, 1);
    assert.deepEqual(getAfter.configuredProviders, ['openrouter']);

    // 4. DELETE key
    const { req: delReq, res: delRes } = mockRequest('DELETE', { provider: 'openrouter' });
    await handleVaultApiRequest(delReq, delRes, vault, user);
    const delData = JSON.parse(delRes.body);
    assert.equal(delData.success, true);
    assert.equal(delData.deleted, true);

    // 5. GET after delete -> count 0
    const { req: getReq3, res: getRes3 } = mockRequest('GET');
    await handleVaultApiRequest(getReq3, getRes3, vault, user);
    const getFinal = JSON.parse(getRes3.body);
    assert.equal(getFinal.count, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('BYOK Vault Gateway Endpoint: returns 500 JSON when master key is missing with lazy Proxy', async () => {
  const routes = new Map();
  const mockWebServer = {
    server: {
      prependListener() {}
    },
    register(route) {
      routes.set(route.path, route);
      return () => routes.delete(route.path);
    }
  };

  // Simulate lazy proxy that throws on access when master key is missing
  let _vault = null;
  const lazyVault = new Proxy({}, {
    get(target, prop) {
      if (!_vault) {
        throw new Error('VAULT_MASTER_KEY_MISSING: set DSH_VAULT_MASTER_KEY (>=32 chars) before using the BYOK vault.');
      }
      return _vault[prop];
    }
  });

  const mockCtx = {
    webServer: mockWebServer,
    get(name) {
      if (name === 'byokVault') return lazyVault;
      return null;
    }
  };

  registerGatewayMiddleware(mockCtx);
  assert.ok(routes.has('/dsh-dds/api/vault/keys'), 'Must register /dsh-dds/api/vault/keys endpoint');

  const req = new EventEmitter();
  req.method = 'GET';
  req.url = '/dsh-dds/api/vault/keys';
  req.headers = {};

  let resStatus = 0;
  let resBody = '';
  const res = {
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    set statusCode(code) { resStatus = code; },
    get statusCode() { return resStatus; },
    end(data) { resBody = data; }
  };

  await routes.get('/dsh-dds/api/vault/keys').handler(req, res);
  assert.equal(resStatus, 500, 'Must return HTTP 500 on vault error');
  const json = JSON.parse(resBody);
  assert.equal(json.success, false);
  assert.equal(json.error, 'VAULT_UNAVAILABLE');
  assert.match(json.message, /VAULT_MASTER_KEY_MISSING/);
});

test('BYOK Vault Gateway Endpoint: authenticated mode rejects missing request identity before vault access', async () => {
  const routes = new Map();
  let vaultAccessed = false;
  const mockCtx = {
    webServer: {
      server: { prependListener() {} },
      register(route) { routes.set(route.path, route); }
    },
    get(name) {
      if (name === 'iam') return { getCurrentUser: () => null };
      if (name === 'byokVault') {
        vaultAccessed = true;
        throw new Error('vault must not be opened before authentication');
      }
      return null;
    }
  };
  registerGatewayMiddleware(mockCtx, { authEnabled: true });

  const req = new EventEmitter();
  req.method = 'GET';
  req.url = '/dsh-dds/api/vault/keys';
  req.headers = {};
  let body = '';
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    end(value) { body = value; }
  };

  await routes.get('/dsh-dds/api/vault/keys').handler(req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(JSON.parse(body).error, 'UNAUTHORIZED');
  assert.equal(vaultAccessed, false);
});
