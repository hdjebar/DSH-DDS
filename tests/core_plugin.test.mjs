import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  name,
  inject,
  apply,
  registerGatewayMiddleware,
  ModelCatalogService,
  registerLocalizationTap,
  registerRbacInterceptor,
  registerSessionEventsShim,
  registerBashWorkdirShim,
  DEFAULT_OPERATOR,
  TOOL_ACTION_MAP,
  KNOWN_POLICY_VERBS,
  fetchSearchUrl
} from '../packages/dsh-dds-core/index.js';
import { isTrustedGatewayIp, isSameOriginOrLoopback } from '../packages/dsh-dds-core/gateway.js';
import { TRANSLATION_DICTIONARY } from '../packages/dsh-dds-core/localization.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

test('Core Plugin: package manifest and exports contract', () => {
  assert.equal(name, '@dsh-dds/core');
  assert.ok(inject, 'inject must be defined');
  assert.equal(typeof apply, 'function');
});

test('Core Gateway: isTrustedGatewayIp recognizes container network bridges and loopback', () => {
  // Loopback
  assert.equal(isTrustedGatewayIp('127.0.0.1'), true);
  assert.equal(isTrustedGatewayIp('::1'), true);
  assert.equal(isTrustedGatewayIp('::ffff:127.0.0.1'), true);
  assert.equal(isTrustedGatewayIp('localhost'), true);

  // Docker bridge & private gateways
  assert.equal(isTrustedGatewayIp('172.17.0.1'), true);
  assert.equal(isTrustedGatewayIp('172.18.0.1'), true);
  assert.equal(isTrustedGatewayIp('172.31.255.254'), true);
  assert.equal(isTrustedGatewayIp('10.0.0.1'), true);
  assert.equal(isTrustedGatewayIp('192.168.1.1'), true);
  assert.equal(isTrustedGatewayIp('169.254.1.1'), true);
  assert.equal(isTrustedGatewayIp('fe80::1'), true);
  assert.equal(isTrustedGatewayIp('fd12:3456::1'), true);

  // Untrusted public IPs must fail closed
  assert.equal(isTrustedGatewayIp('8.8.8.8'), false);
  assert.equal(isTrustedGatewayIp('1.1.1.1'), false);
  assert.equal(isTrustedGatewayIp('172.15.0.1'), false);
  assert.equal(isTrustedGatewayIp('172.32.0.1'), false);
  assert.equal(isTrustedGatewayIp(''), false);
  assert.equal(isTrustedGatewayIp(null), false);
});

test('Core Gateway: isSameOriginOrLoopback handles origin and host port normalization', () => {
  assert.equal(isSameOriginOrLoopback('http://localhost:3080', '127.0.0.1:3080'), true);
  assert.equal(isSameOriginOrLoopback('http://127.0.0.1:3080', 'localhost:3080'), true);
  assert.equal(isSameOriginOrLoopback('http://172.17.0.1:3080', '127.0.0.1:3080'), true);
  assert.equal(isSameOriginOrLoopback('http://localhost:3080', 'localhost:3080'), true);

  // Port mismatch must reject
  assert.equal(isSameOriginOrLoopback('http://localhost:3080', '127.0.0.1:4000'), false);

  // Untrusted origin must reject
  assert.equal(isSameOriginOrLoopback('http://evil.com:3080', '127.0.0.1:3080'), false);
});

test('Core Gateway: registers restart and health endpoints on mock webServer', async () => {
  const routes = new Map();
  const listeners = [];

  const mockWebServer = {
    server: {
      prependListener(event, fn) {
        listeners.push({ event, fn });
      }
    },
    register(route) {
      routes.set(route.path, route);
      return () => routes.delete(route.path);
    }
  };

  const mockCtx = { webServer: mockWebServer };
  registerGatewayMiddleware(mockCtx);

  assert.ok(routes.has('/dsh-dds/lifecycle/restart'), 'Must register /dsh-dds/lifecycle/restart');
  assert.ok(routes.has('/dsh-dds/health'), 'Must register /dsh-dds/health');

  // Test health check route
  let healthStatus = 0;
  let healthBody = '';
  const mockHealthRes = {
    set statusCode(code) { healthStatus = code; },
    setHeader() {},
    end(str) { healthBody = str; }
  };
  await routes.get('/dsh-dds/health').handler({}, mockHealthRes);
  assert.equal(healthStatus, 200);
  const healthJson = JSON.parse(healthBody);
  assert.equal(healthJson.status, 'healthy');
  assert.ok(healthJson.timestamp);
});

test('Core Localization: registerLocalizationTap transforms index HTML cleanly', () => {
  let tapFn = null;
  const mockWebServer = {
    tapIndex(fn) {
      tapFn = fn;
    }
  };

  registerLocalizationTap({ webServer: mockWebServer });
  assert.equal(typeof tapFn, 'function', 'Must register tapIndex transform');

  const rawHtml = '<!DOCTYPE html><html><head><title>DSH</title></head><body><div id="app"></div></body></html>';
  const transformed = tapFn(rawHtml);

  assert.ok(transformed.includes('id="dsh-dds-i18n-tap"'), 'Must inject translation script');
  assert.ok(transformed.includes('Plugin Market'), 'Must include translation dictionary');
  assert.ok(transformed.includes('Memory Spaces'), 'Must include memory translations');
  assert.ok(transformed.endsWith('</body></html>'), 'Must place script before </body>');

  // Test idempotency
  const doubleTransformed = tapFn(transformed);
  assert.equal(doubleTransformed, transformed, 'tapIndex must be idempotent');
});

test('Core ModelCatalogService: initializes and registers API sync route', () => {
  const routes = new Map();
  const events = new Map();

  const mockCtx = {
    webServer: {
      register(route) {
        routes.set(route.path, route);
      }
    },
    on(eventName, fn) {
      events.set(eventName, fn);
    }
  };

  const service = new ModelCatalogService(mockCtx, { modelSyncIntervalHours: 6 });
  service.start();

  try {
    assert.ok(routes.has('/dsh-dds/api/models/sync'), 'Must register /dsh-dds/api/models/sync');
    assert.ok(events.has('models:sync'), 'Must listen to models:sync event');
    assert.equal(typeof service.syncModels, 'function');
  } finally {
    service.stop();
  }
});

test('Core Plugin: full plugin apply activates all subsystems cleanly', () => {
  const routes = new Map();
  const events = new Map();
  const provided = new Map();

  const mockCtx = {
    webServer: {
      server: {
        prependListener() {}
      },
      register(route) {
        routes.set(route.path, route);
      },
      tapIndex() {}
    },
    provide(key, val) {
      provided.set(key, val);
    },
    on(eventName, fn) {
      events.set(eventName, fn);
    }
  };

  apply(mockCtx, { modelSyncIntervalHours: 24 });

  assert.ok(provided.has('modelCatalog'), 'Must provide modelCatalog service');
  assert.ok(routes.has('/dsh-dds/lifecycle/restart'), 'Must register restart route');
  assert.ok(routes.has('/dsh-dds/api/models/sync'), 'Must register model sync route');

  // Clean up
  const catalog = provided.get('modelCatalog');
  catalog.stop();
});

test('Core RBAC Interceptor: intercepts and blocks unauthorized tool actions', async () => {
  let beforeHook = null;
  const mockCtx = {
    user: DEFAULT_OPERATOR,
    before(event, fn) {
      if (event === 'tool-execute') beforeHook = fn;
    }
  };

  registerRbacInterceptor(mockCtx, { enableToolRbac: true });
  assert.equal(typeof beforeHook, 'function', 'Must register before tool-execute hook');

  // Test authorized action
  const benignContext = {
    toolName: 'read_case',
    action: 'read_file',
    target: '/workspaces/cases/report.md',
    persona: {
      name: 'test-auditor',
      rbac: {
        role: 'auditor',
        permissions: {
          filesystem: {
            read: ['/workspaces/cases'],
            write: [],
            deny: ['reset.sh']
          }
        }
      }
    }
  };
  await assert.doesNotReject(async () => {
    await beforeHook(benignContext);
  });

  // Test unauthorized action violating deny rule
  const maliciousContext = {
    toolName: 'execute_reset',
    action: 'execute_command',
    target: 'reset.sh',
    persona: {
      name: 'test-auditor',
      rbac: {
        role: 'auditor',
        permissions: {
          filesystem: {
            read: ['/workspaces/cases'],
            write: [],
            deny: ['reset.sh']
          }
        }
      }
    }
  };
  await assert.rejects(
    async () => {
      await beforeHook(maliciousContext);
    },
    /Zero-Trust RBAC Violation/
  );

  // Test unmapped tool fails closed
  await assert.rejects(
    async () => {
      await beforeHook({
        toolName: 'unknown_unmapped_tool',
        target: '/workspaces/cases/report.md'
      });
    },
    /Zero-Trust RBAC Violation.*unmapped or unauthorized tool/
  );

  // Test missing identity context fails closed
  const noUserCtx = {
    before(event, fn) {
      if (event === 'tool-execute') beforeHook = fn;
    }
  };
  registerRbacInterceptor(noUserCtx, { enableToolRbac: true });
  await assert.rejects(
    async () => {
      await beforeHook({
        toolName: 'read_file',
        target: '/workspaces/cases/report.md'
      });
    },
    /Zero-Trust RBAC Violation.*Missing authenticated user identity context/
  );
});

test('Core Plugin: registerSessionEventsShim attaches iterable events getter to Session prototype', () => {
  class MockSession {
    snapshotEvents() {
      return [{ id: 'evt-1', type: 'turn/start' }, { id: 'evt-2', type: 'turn/end' }];
    }
  }

  registerSessionEventsShim(MockSession);

  const instance = new MockSession();
  assert.ok(Array.isArray(instance.events), 'instance.events must be an array');
  assert.equal(instance.events.length, 2, 'instance.events length must match snapshotEvents');
  assert.equal(typeof instance.events[Symbol.iterator], 'function', 'instance.events must be iterable');

  // Verify iteration
  const collected = [];
  for (const event of instance.events) {
    collected.push(event.id);
  }
  assert.deepEqual(collected, ['evt-1', 'evt-2']);
});

test('Core Plugin: registerBashWorkdirShim guarantees spec.workdir exists and falls back safely', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');

  class MockExecutor {
    spawnSpec(spec, argv, stdoutMaxBytes, signal) {
      return { cwd: spec.workdir, argv };
    }
  }

  registerBashWorkdirShim(MockExecutor);

  const instance = new MockExecutor();

  // Test 1: Nonexistent directory in writable tmp location gets created
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-core-test-'));
  const targetDir = path.join(tmpBase, 'sub', 'workspace');
  assert.equal(fs.existsSync(targetDir), false);

  const res1 = instance.spawnSpec({ workdir: targetDir }, ['ls'], 1024, null);
  assert.equal(res1.cwd, targetDir);
  assert.equal(fs.existsSync(targetDir), true, 'Target directory must be auto-created');

  // Test 2: Invalid/throwing directory falls back to an existing directory
  // E.g., a path under a regular file causes mkdirSync to fail with ENOTDIR
  const dummyFile = path.join(tmpBase, 'dummy.txt');
  fs.writeFileSync(dummyFile, 'hello');
  const impossibleDir = path.join(dummyFile, 'nested');

  const res2 = instance.spawnSpec({ workdir: impossibleDir }, ['ls'], 1024, null);
  assert.ok(fs.existsSync(res2.cwd), 'Fallback directory must exist on disk');

  // Test 3: Idempotency (wrapper is not duplicated)
  registerBashWorkdirShim(MockExecutor);
  const res3 = instance.spawnSpec({ workdir: targetDir }, ['ls'], 1024, null);
  assert.equal(res3.cwd, targetDir);

  // Clean up
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

test('Web Search Fallback: parseDuckDuckGoHtml extracts structured search results', async () => {
  const { parseDuckDuckGoHtml } = await import('../packages/dsh-dds-core/index.js');
  const sampleHtml = `
    <div class="result results_links">
      <h2 class="result__title">
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdeepseek&rut=123">DeepSeek AI News</a>
      </h2>
      <a class="result__snippet">Official release and updates about DeepSeek LLM models.</a>
    </div>
    <div class="result results_links">
      <h2 class="result__title">
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fstats&rut=456">European Statistics</a>
      </h2>
      <a class="result__snippet">SDMX and economic indicators for EU member states.</a>
    </div>
  `;

  const results = parseDuckDuckGoHtml(sampleHtml, 5);
  assert.equal(results.length, 2);
  assert.equal(results[0].title, 'DeepSeek AI News');
  assert.equal(results[0].url, 'https://example.com/deepseek');
  assert.equal(results[0].snippet, 'Official release and updates about DeepSeek LLM models.');
  assert.equal(results[1].title, 'European Statistics');
  assert.equal(results[1].url, 'https://example.org/stats');
});

test('Web Search Fallback: registerWebSearchFallback intercepts engine failure and engages fallback', async () => {
  const { registerWebSearchFallback } = await import('../packages/dsh-dds-core/index.js');

  let originalCalled = false;
  const mockCtx = {
    web: {
      search: async (req) => {
        originalCalled = true;
        throw new Error('Error: modsearch failed (exit 1): Error: Every engine for the web source failed. - firecrawl: firecrawl rejected the keyless request (403)');
      }
    }
  };

  registerWebSearchFallback(mockCtx);
  assert.ok(mockCtx.web.__dds_wrapped, 'ctx.web must be wrapped');

  const res = await mockCtx.web.search({ query: 'test query' });
  assert.equal(originalCalled, true, 'Original search must be attempted first');
  assert.ok(res.content, 'Fallback search must return content');
  assert.ok(Array.isArray(res.sources), 'Fallback search must return sources array');
  assert.equal(res.truncated, false);
});

test('Core RBAC Interceptor: TOOL_ACTION_MAP precedence and prototype isolation', async () => {
  // Prototype isolation
  assert.equal(Object.getPrototypeOf(TOOL_ACTION_MAP), null, 'TOOL_ACTION_MAP must have null prototype');
  assert.equal(TOOL_ACTION_MAP['constructor'], undefined);
  assert.equal(TOOL_ACTION_MAP['toString'], undefined);
  assert.ok(KNOWN_POLICY_VERBS.has('run_shell'));

  let beforeHook = null;
  const mockCtx = {
    user: DEFAULT_OPERATOR,
    before(event, fn) {
      if (event === 'tool-execute') beforeHook = fn;
    }
  };
  registerRbacInterceptor(mockCtx, { enableToolRbac: true });

  // 1. Precedence: toolName 'bash' beats generic action 'execute' -> maps to run_shell
  await assert.doesNotReject(async () => {
    await beforeHook({
      toolName: 'bash',
      action: 'execute',
      workdir: '/workspaces/cases',
      command: 'npm --version',
      persona: {
        name: 'test-operator',
        rbac: {
          role: 'operator',
          permissions: {
            filesystem: {
              read: ['/workspaces'],
              write: ['/workspaces/cases'],
              deny: []
            }
          }
        }
      }
    });
  });

  // 2. Prototype pollution injection attempts fail closed
  await assert.rejects(
    async () => {
      await beforeHook({
        toolName: 'constructor',
        action: 'pollute'
      });
    },
    /Zero-Trust RBAC Violation.*unmapped or unauthorized tool/
  );

  await assert.rejects(
    async () => {
      await beforeHook({
        toolName: 'unknown_tool',
        action: 'toString'
      });
    },
    /Zero-Trust RBAC Violation.*unmapped or unauthorized tool/
  );

  // 3. Known policy verb without toolName succeeds resolution
  await assert.doesNotReject(async () => {
    await beforeHook({
      action: 'validate_sdmx_schema',
      target: '/workspaces/cases/schema.xml',
      persona: {
        name: 'test-operator',
        rbac: {
          role: 'operator',
          permissions: {
            filesystem: {
              read: ['/workspaces/cases'],
              write: [],
              deny: []
            }
          }
        }
      }
    });
  });
});

test('Core RBAC Interceptor: shell command is separated from target path and checked against deny rules', async () => {
  let beforeHook = null;
  const mockCtx = {
    user: DEFAULT_OPERATOR,
    before(event, fn) {
      if (event === 'tool-execute') beforeHook = fn;
    }
  };
  registerRbacInterceptor(mockCtx, { enableToolRbac: true });

  const personaWithDeny = {
    name: 'test-developer',
    rbac: {
      role: 'developer',
      permissions: {
        filesystem: {
          read: ['/workspaces'],
          write: ['/workspaces/cases'],
          deny: ['reset.sh', 'rm -rf /']
        }
      }
    }
  };

  // 1. Non-path command string inside allowed workdir must NOT fail write allowlist checks
  await assert.doesNotReject(async () => {
    await beforeHook({
      toolName: 'bash',
      command: 'npm test -- --coverage',
      workdir: '/workspaces/cases',
      persona: personaWithDeny
    });
  });

  // 2. Shell command containing denied token must be rejected with RBAC_DENY_VIOLATION
  await assert.rejects(
    async () => {
      await beforeHook({
        toolName: 'bash',
        command: 'bash reset.sh --force',
        workdir: '/workspaces/cases',
        persona: personaWithDeny
      });
    },
    /Command '.*' contains denied token 'reset.sh'/
  );

  // 3. Shell command targeting denied pattern rm -rf /
  await assert.rejects(
    async () => {
      await beforeHook({
        toolName: 'bash',
        command: 'rm -rf / --no-preserve-root',
        workdir: '/workspaces/cases',
        persona: personaWithDeny
      });
    },
    /Command '.*' contains denied token 'rm -rf \/'/
  );
});

test('Core RBAC Interceptor: fails closed when policy engine is unavailable', async () => {
  let beforeHook = null;
  const mockCtx = {
    user: DEFAULT_OPERATOR,
    before(event, fn) {
      if (event === 'tool-execute') beforeHook = fn;
    }
  };

  // Explicitly supply a null/broken policy engine
  registerRbacInterceptor(mockCtx, {
    enableToolRbac: true,
    getRbacEngine: async () => null
  });

  await assert.rejects(
    async () => {
      await beforeHook({
        toolName: 'read_file',
        target: '/workspaces/cases/test.txt'
      });
    },
    /Zero-Trust RBAC Violation.*Policy engine unavailable/
  );
});

test('Web Search Fallback: enforces HTTPS and duckduckgo.com domain restrictions', async () => {
  // Reject plain HTTP
  await assert.rejects(
    () => fetchSearchUrl('http://html.duckduckgo.com/html/?q=test'),
    /Insecure search protocol rejected: http:/
  );

  // Reject external / non-duckduckgo hosts
  await assert.rejects(
    () => fetchSearchUrl('https://evil.attacker.com/steal?q=test'),
    /External search host rejected: evil.attacker.com/
  );

  // Reject internal loopback / metadata IP SSRF attempts
  await assert.rejects(
    () => fetchSearchUrl('https://169.254.169.254/latest/meta-data'),
    /External search host rejected: 169.254.169.254/
  );
});




