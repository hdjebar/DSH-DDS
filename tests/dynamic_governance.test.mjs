import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { McpLifecycleManager } from '../config/dynamic-governance.mjs';

test('McpLifecycleManager: registers and unregisters servers and tools', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-mcp-test-'));
  const registryPath = path.join(tmpDir, 'mcp-reg.json');

  const manager = new McpLifecycleManager({
    registryPath,
    workspaceRoot: tmpDir
  });

  // Register server
  const server = manager.registerServer({
    name: 'custom-scanner',
    command: 'node',
    args: ['scanner.js'],
    tools: [
      { name: 'scan_repo', schema: { type: 'object' } }
    ]
  });

  assert.equal(server.name, 'custom-scanner');
  assert.equal(manager.listServers().length, 1);
  assert.ok(manager.listTools().includes('mcp:custom-scanner:scan_repo'));

  // Register additional tool
  manager.registerTool({
    serverName: 'custom-scanner',
    toolName: 'deep_audit',
    handler: async (params) => ({ audited: true, target: params.target })
  });
  assert.ok(manager.listTools().includes('mcp:custom-scanner:deep_audit'));

  // Unregister server
  manager.unregisterServer('custom-scanner');
  assert.equal(manager.listServers().length, 0);
  assert.equal(manager.listTools().length, 0);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('McpLifecycleManager: path sanitization enforces directory boundary containment', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-mcp-boundary-'));
  const registryPath = path.join(tmpDir, 'mcp-reg.json');

  const manager = new McpLifecycleManager({
    registryPath,
    workspaceRoot: tmpDir
  });

  const realTmpDir = fs.realpathSync(tmpDir);
  const validFile = path.join(tmpDir, 'valid.txt');
  const realValidFile = path.join(realTmpDir, 'valid.txt');
  fs.writeFileSync(validFile, 'hello');

  // Allowed workspace path
  const sanitized = manager.sanitizeArguments({
    target: validFile,
    name: 'test-operation'
  });
  assert.equal(sanitized.target, realValidFile);
  assert.equal(sanitized.name, 'test-operation');

  // Prohibited system path
  assert.throws(() => {
    manager.sanitizeArguments({ target: '/etc/shadow' });
  }, /Zero-Trust Path Traversal Blocked/);

  // Traversal outside workspace
  assert.throws(() => {
    manager.sanitizeArguments({ path: path.join(tmpDir, '../outside-file.txt') });
  }, /Zero-Trust Path Traversal Blocked/);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('McpLifecycleManager: executes tool calls and invokes handlers', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-mcp-exec-'));
  const registryPath = path.join(tmpDir, 'mcp-reg.json');

  const manager = new McpLifecycleManager({
    registryPath,
    workspaceRoot: tmpDir
  });

  manager.registerServer({
    name: 'sqlite-worker',
    command: 'mcp-server-sqlite'
  });

  manager.registerTool({
    serverName: 'sqlite-worker',
    toolName: 'query_db',
    handler: async (params) => ({
      status: 'success',
      rows: [{ id: 1, name: 'Alice' }],
      query: params.sql
    })
  });

  const result = await manager.executeMcpTool('mcp:sqlite-worker:query_db', {
    sql: 'SELECT * FROM users;'
  });

  assert.equal(result.status, 'success');
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].name, 'Alice');

  // Unregistered tool fails closed
  await assert.rejects(async () => {
    await manager.executeMcpTool('mcp:unknown:tool');
  }, /is not registered in the dynamic MCP lifecycle registry/);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('McpLifecycleManager: persists registrations across instances', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-mcp-persist-'));
  const registryPath = path.join(tmpDir, 'mcp-persist.json');

  const manager1 = new McpLifecycleManager({
    registryPath,
    workspaceRoot: tmpDir
  });

  manager1.registerServer({
    name: 'persistent-srv',
    command: 'worker',
    tools: [{ name: 'ping' }]
  });

  // Verify file written to disk
  assert.ok(fs.existsSync(registryPath));

  // Instantiate second manager reading same path
  const manager2 = new McpLifecycleManager({
    registryPath,
    workspaceRoot: tmpDir
  });

  assert.equal(manager2.listServers().length, 1);
  assert.equal(manager2.listServers()[0].name, 'persistent-srv');
  assert.ok(manager2.listTools().includes('mcp:persistent-srv:ping'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
