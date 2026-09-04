import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { DeclarativeWorkflowEngine, runAgentWorkflow, AgentPhoenixTracer } from '../config/declarative-orchestrator.mjs';
import { isContainedWithin, enforceRbacPolicy } from '../config/rbac-policy.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// AUD-019: Isolate runtime state and audit logs to temporary test directory
const testIsolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-test-isolation-'));
process.env.DSH_RUNTIME_DIR = testIsolatedDir;
process.env.DSH_AUDIT_LOG_FILE = path.join(testIsolatedDir, 'audit_grc.jsonl');
process.env.DSH_SESSIONS_DIR = path.join(testIsolatedDir, 'sessions');

test('RBAC Policy: strict directory boundary containment', () => {
  assert.equal(isContainedWithin('/tmp/allowed/sub/file.txt', '/tmp/allowed'), true);
  assert.equal(isContainedWithin('/tmp/allowed', '/tmp/allowed'), true);
  // Boundary traversal attack: /tmp/allowed-evil must NOT be authorized by /tmp/allowed
  assert.equal(isContainedWithin('/tmp/allowed-evil', '/tmp/allowed'), false);
  assert.equal(isContainedWithin('/tmp/allowed-evil/file.txt', '/tmp/allowed'), false);
  assert.equal(isContainedWithin('/etc/shadow', '/tmp/allowed'), false);
});

test('Declarative Orchestrator: executes structured steps with real capability adapters', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-orch-test-'));
  const reportPath = path.join(tmpDir, 'test_report.json');

  const meta = {
    name: 'security-auditor',
    models: {
      default: { provider: 'google', model: 'gemini-1.5-pro' }
    },
    rbac: {
      role: 'security_auditor',
      permissions: {
        filesystem: {
          read: [ROOT, tmpDir],
          write: [tmpDir, ROOT],
          deny: ['/etc', 'reset.sh', 'install_dsh.sh']
        }
      }
    },
    workflows: {
      audit_pipeline: {
        steps: [
          {
            name: 'Collect Sources',
            action: 'fetch_sources',
            scope: ROOT
          },
          {
            name: 'Run LLM Vulnerability Scan',
            action: 'run_llm_query',
            prompt: 'Audit configuration files for RCE vectors'
          },
          {
            name: 'Apply Verification Patch',
            action: 'apply_fix_or_patch',
            target: path.join(tmpDir, 'test.patch')
          },
          {
            name: 'Write Audit Report',
            action: 'write_report',
            destination: reportPath
          }
        ]
      }
    }
  };

  try {
    const engine = new DeclarativeWorkflowEngine(meta);
    const result = await engine.executeWorkflow('audit_pipeline', { initial_var: 'test_value' });

    assert.equal(result.status, 'COMPLETED');
    assert.equal(result.persona, 'security-auditor');
    assert.equal(result.executionLogs.length, 4);
    assert.equal(result.executionLogs[0].status, 'SUCCESS');
    assert.equal(result.executionLogs[1].status, 'SUCCESS');
    assert.equal(result.executionLogs[2].status, 'SUCCESS');
    assert.equal(result.executionLogs[3].status, 'SUCCESS');

    // Verify context propagation
    assert.equal(result.finalContext.initial_var, 'test_value');
    assert.ok(result.finalContext.sources);
    assert.ok(result.finalContext.llm_response);
    assert.ok(result.finalContext.patch_status);
    assert.ok(result.finalContext.report);

    // Verify real file written to disk
    assert.ok(fs.existsSync(reportPath), 'Report file must exist on disk');
    const writtenData = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert.equal(writtenData.persona, 'security-auditor');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Declarative Orchestrator: strict fail-closed on unknown or unhandled actions', async () => {
  const meta = {
    name: 'test-agent',
    rbac: {
      role: 'tester',
      permissions: {
        filesystem: { read: [ROOT], write: [ROOT], deny: [] }
      }
    },
    workflows: {
      unknown_action_wf: {
        steps: [
          {
            name: 'Invoke Fabricated Action',
            action: 'non_existent_exploit_action'
          }
        ]
      }
    }
  };

  const engine = new DeclarativeWorkflowEngine(meta);
  await assert.rejects(
    async () => {
      await engine.executeWorkflow('unknown_action_wf');
    },
    /UNKNOWN_ACTION_ERROR: Workflow action 'non_existent_exploit_action' is not registered/
  );
});

test('Declarative Orchestrator: fail-closed when persona manifest lacks RBAC contract', async () => {
  const metaWithoutRbac = {
    name: 'unauthorized-agent',
    workflows: {
      wf: {
        steps: [{ name: 'Step 1', action: 'fetch_sources' }]
      }
    }
  };

  const engine = new DeclarativeWorkflowEngine(metaWithoutRbac);
  await assert.rejects(
    async () => {
      await engine.executeWorkflow('wf');
    },
    /RBAC_MANIFEST_MISSING/
  );
});

test('Declarative Orchestrator: enforces read and write allowlists with directory boundary', async () => {
  const tmpAllowed = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-allowed-'));
  const tmpEvil = `${tmpAllowed}-evil`;

  const meta = {
    name: 'restricted-agent',
    rbac: {
      role: 'restricted',
      permissions: {
        filesystem: {
          read: [tmpAllowed],
          write: [tmpAllowed],
          deny: ['/etc', 'reset.sh']
        }
      }
    },
    workflows: {
      prefix_escape_write: {
        steps: [
          {
            name: 'Prefix Escape Write',
            action: 'write_report',
            destination: path.join(tmpEvil, 'exploit.json')
          }
        ]
      },
      unauthorized_read: {
        steps: [
          {
            name: 'Read Outside Allowlist',
            action: 'fetch_sources',
            scope: '/opt/unauthorized_scan'
          }
        ]
      }
    }
  };

  try {
    const engine = new DeclarativeWorkflowEngine(meta);

    // Must reject prefix write escape (/tmp/allowed-evil is not /tmp/allowed)
    await assert.rejects(
      async () => {
        await engine.executeWorkflow('prefix_escape_write');
      },
      /RBAC_WRITE_UNAUTHORIZED/
    );

    // Must reject reading outside filesystem.read
    await assert.rejects(
      async () => {
        await engine.executeWorkflow('unauthorized_read');
      },
      /RBAC_READ_UNAUTHORIZED/
    );
  } finally {
    fs.rmSync(tmpAllowed, { recursive: true, force: true });
  }
});

test('Declarative Orchestrator: detects and rejects symlink traversal escapes (F-02)', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-symlink-test-'));
  const allowedDir = path.join(tmpRoot, 'allowed');
  const outsideDir = path.join(tmpRoot, 'outside');
  fs.mkdirSync(allowedDir, { recursive: true });
  fs.mkdirSync(outsideDir, { recursive: true });

  const pivotLink = path.join(allowedDir, 'pivot');
  try {
    fs.symlinkSync(outsideDir, pivotLink, 'dir');
  } catch (err) {
    // Skip if environment doesn't allow symlinks
    return;
  }

  const meta = {
    name: 'symlink-attacker',
    rbac: {
      role: 'restricted',
      permissions: {
        filesystem: {
          read: [allowedDir],
          write: [allowedDir],
          deny: []
        }
      }
    },
    workflows: {
      symlink_escape_wf: {
        steps: [
          {
            name: 'Escape via Pivot Symlink',
            action: 'write_report',
            destination: path.join(pivotLink, 'escaped.json')
          }
        ]
      }
    }
  };

  try {
    const engine = new DeclarativeWorkflowEngine(meta);
    await assert.rejects(
      async () => {
        await engine.executeWorkflow('symlink_escape_wf');
      },
      /RBAC_SYMLINK_ESCAPE/
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('Declarative Orchestrator: capability adapters perform real cryptographic hashing (F-04)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-hash-test-'));
  const sampleFile = path.join(tmpDir, 'evidence.txt');
  fs.writeFileSync(sampleFile, 'Immutable Audit Evidence Payload', 'utf8');

  const meta = {
    name: 'forensic-investigator',
    rbac: {
      role: 'forensics',
      permissions: {
        filesystem: {
          read: [tmpDir],
          write: [tmpDir],
          deny: []
        }
      }
    },
    workflows: {
      investigation_wf: {
        steps: [
          {
            name: 'Compute Evidence Hashes',
            action: 'forensic_investigation',
            scope: tmpDir
          }
        ]
      }
    }
  };

  try {
    const engine = new DeclarativeWorkflowEngine(meta);
    const result = await engine.executeWorkflow('investigation_wf');
    assert.equal(result.status, 'COMPLETED');
    assert.equal(result.executionLogs[0].status, 'SUCCESS');
    const forensics = result.finalContext.forensics;
    assert.ok(forensics);
    assert.equal(forensics.files_hashed, 1);
    assert.ok(forensics.hashes['evidence.txt']);
    assert.equal(forensics.hashes['evidence.txt'].length, 64); // Valid SHA-256 hex string
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Declarative Orchestrator: ACM approval gate suspends workflow and halts subsequent steps', async () => {
  const meta = {
    name: 'acm-agent',
    rbac: {
      role: 'acm_tester',
      permissions: {
        filesystem: { read: [ROOT], write: [ROOT], deny: [] }
      }
    },
    workflows: {
      gated_wf: {
        steps: [
          {
            name: 'Step 1: Evaluation',
            action: 'parse_intent'
          },
          {
            name: 'Step 2: Approval Gate',
            action: 'parse_intent',
            approval_required: true
          },
          {
            name: 'Step 3: Should Not Execute',
            action: 'parse_intent'
          }
        ]
      }
    }
  };

  const engine = new DeclarativeWorkflowEngine(meta);
  const result = await engine.executeWorkflow('gated_wf', { approved: false });

  // Execution must suspend on approval gate
  assert.equal(result.status, 'SUSPENDED_APPROVAL_REQUIRED');
  assert.ok(result.suspendedReason.includes('requires approval'));
  assert.equal(result.executionLogs.length, 2);
  assert.equal(result.executionLogs[0].status, 'SUCCESS');
  assert.equal(result.executionLogs[1].status, 'GATED');
  // Step 3 must NOT have executed
  assert.equal(result.executionLogs.some(l => l.step.includes('Step 3')), false);
});

test('Declarative Orchestrator: condition evaluation handles nested properties and booleans', () => {
  const engine = new DeclarativeWorkflowEngine({ name: 'eval-test' });
  const ctx = {
    incident_severity: { severity: 'CRITICAL', score: 9.5 },
    is_active: true,
    environment: 'production'
  };

  assert.equal(engine.evaluateCondition("incident_severity == 'CRITICAL'", ctx), true);
  assert.equal(engine.evaluateCondition("incident_severity.severity == 'CRITICAL'", ctx), true);
  assert.equal(engine.evaluateCondition("incident_severity.severity != 'LOW'", ctx), true);
  assert.equal(engine.evaluateCondition("environment == 'production'", ctx), true);
  assert.equal(engine.evaluateCondition("environment == 'staging'", ctx), false);
  assert.equal(engine.evaluateCondition("is_active", ctx), true);
});

test('Declarative Orchestrator: AgentPhoenixTracer generates correlated parent-child spans', async () => {
  const tracer = new AgentPhoenixTracer('http://127.0.0.1:59999');
  const traceId = tracer.generateTraceId();
  const rootSpanId = tracer.generateSpanId();
  const childSpanId = tracer.generateSpanId();

  assert.equal(traceId.length, 32);
  assert.equal(rootSpanId.length, 16);

  await assert.doesNotReject(async () => {
    await tracer.sendSpan({
      traceId,
      spanId: rootSpanId,
      name: 'root.workflow',
      startTime: Date.now(),
      endTime: Date.now() + 5
    });

    await tracer.sendSpan({
      traceId,
      spanId: childSpanId,
      parentSpanId: rootSpanId,
      name: 'child.step',
      startTime: Date.now(),
      endTime: Date.now() + 2
    });
  });
});

test('Declarative Orchestrator: runAgentWorkflow bridge executes real persona workflow', async () => {
  const res = await runAgentWorkflow('security-auditor', 'audit_code');
  assert.equal(res.success, true);
  assert.equal(res.execution.status, 'COMPLETED');
  assert.ok(res.execution.executionLogs.length >= 4);
});

test('AUD-001 Regression: targetless write action fails closed unless default target is allowlisted', async () => {
  const restrictedMeta = {
    name: 'restricted-persona',
    models: { default: { model: 'test' } },
    rbac: {
      role: 'restricted_role',
      permissions: {
        filesystem: {
          read: ['/workspaces'],
          write: ['/tmp/allowed-only-dir'],
          deny: []
        }
      }
    },
    workflows: {
      targetless_containment: {
        steps: [
          { name: 'Targetless Containment', action: 'contain_threat' }
        ]
      },
      targetless_create: {
        steps: [
          { name: 'Targetless Create', action: 'create_file' }
        ]
      }
    }
  };

  const engine = new DeclarativeWorkflowEngine(restrictedMeta);

  // 1. contain_threat without target resolves to quarantine default, which is NOT in write allowlist
  await assert.rejects(
    async () => engine.executeWorkflow('targetless_containment'),
    /RBAC_WRITE_UNAUTHORIZED/
  );

  // 2. create_file without target has no default and fails closed with RBAC_TARGET_REQUIRED
  await assert.rejects(
    async () => engine.executeWorkflow('targetless_create'),
    /RBAC_TARGET_REQUIRED/
  );
});

test('AUD-005 Regression: semantic adapter failures result in FAILED workflow status', async () => {
  const probeMeta = {
    name: 'probe-tester',
    models: { default: { model: 'test' } },
    rbac: {
      role: 'probe_role',
      permissions: {
        filesystem: { read: ['/workspaces'], write: ['/workspaces'] }
      }
    },
    workflows: {
      unreachable_service: {
        steps: [
          { name: 'Probe Dead Port', action: 'probe_services', target: 'http://127.0.0.1:9' }
        ]
      },
      missing_sqlite: {
        steps: [
          { name: 'Inspect Missing DB', action: 'inspect_sqlite', target: '/workspaces/does_not_exist.db' }
        ]
      }
    }
  };

  const engine = new DeclarativeWorkflowEngine(probeMeta);

  // Unreachable port returns status: 'failed' and fails the workflow
  const serviceRes = await engine.executeWorkflow('unreachable_service');
  assert.equal(serviceRes.status, 'FAILED');
  assert.equal(serviceRes.executionLogs[0].status, 'FAILED');

  // Missing SQLite database returns status: 'failed' and fails the workflow
  const sqliteRes = await engine.executeWorkflow('missing_sqlite');
  assert.equal(sqliteRes.status, 'FAILED');
  assert.equal(sqliteRes.executionLogs[0].status, 'FAILED');
});

test.after(() => {
  fs.rmSync(testIsolatedDir, { recursive: true, force: true });
});
