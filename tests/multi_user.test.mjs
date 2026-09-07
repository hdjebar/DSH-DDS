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
  registerRbacInterceptor
} from '../packages/dsh-dds-core/index.js';
import { EventEmitter } from 'node:events';

test('IAM Service: default fallback when unauthenticated in single-operator mode', () => {
  const result = extractUserFromHeaders({}, { authEnabled: false });
  assert.equal(result.id, 'default');
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
    assert.equal(paths.userId, 'alice');
    assert.equal(paths.sessions, path.join(userBase, 'alice', 'sessions'));
    assert.equal(paths.workspace, path.join(wsBase, 'users', 'alice'));
    assert.equal(paths.sharedWorkspace, path.join(wsBase, 'shared'));

    // Admin user has global access
    const adminCheck = mgr.validatePathAccess(path.join(wsBase, 'users', 'bob', 'file.txt'), { id: 'admin', roles: ['admin'] });
    assert.equal(adminCheck.allowed, true);

    // Alice accessing her own workspace
    const aliceSelf = mgr.validatePathAccess(path.join(wsBase, 'users', 'alice', 'data.csv'), { id: 'alice', roles: ['user'] });
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
        target: path.join(wsBase, 'users', 'alice', 'document.txt')
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
