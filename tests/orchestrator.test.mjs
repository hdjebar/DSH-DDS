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

// AUD-019 & PR-011: Isolate runtime state, audit logs, sessions, and workspaces to temporary test directory
const testIsolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-test-isolation-'));
process.env.DSH_RUNTIME_DIR = testIsolatedDir;
process.env.DSH_AUDIT_LOG_FILE = path.join(testIsolatedDir, 'audit_grc.jsonl');
process.env.DSH_SESSIONS_DIR = path.join(testIsolatedDir, 'sessions');
process.env.DSH_WORKSPACE_ROOT = path.join(testIsolatedDir, 'workspaces');
process.env.DSH_MOCK_LLM = 'true';
fs.mkdirSync(process.env.DSH_WORKSPACE_ROOT, { recursive: true });
fs.mkdirSync(process.env.DSH_SESSIONS_DIR, { recursive: true });

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
            target: path.join(tmpDir, 'test.patch'),
            content: '# Test verification patch content\n'
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

test('PR-002 Regression: non-string resource fields fail closed with RBAC_TARGET_INVALID', async () => {
  const meta = {
    name: 'type-test-persona',
    models: { default: { model: 'test' } },
    rbac: {
      role: 'security_auditor',
      permissions: {
        filesystem: {
          read: ['/workspaces'],
          write: ['/workspaces/cases', '/tmp']
        }
      }
    },
    workflows: {
      array_target: { steps: [{ name: 'Array Target', action: 'contain_threat', target: ['/tmp/allowed'] }] },
      object_target: { steps: [{ name: 'Object Target', action: 'contain_threat', target: { path: '/tmp/allowed' } }] },
      number_target: { steps: [{ name: 'Number Target', action: 'contain_threat', target: 12345 }] },
      boolean_target: { steps: [{ name: 'Boolean Target', action: 'contain_threat', target: true }] },
      empty_target: { steps: [{ name: 'Empty Target', action: 'contain_threat', target: '' }] },
      whitespace_target: { steps: [{ name: 'Whitespace Target', action: 'contain_threat', target: '   ' }] },
      array_destination: { steps: [{ name: 'Array Destination', action: 'write_report', destination: ['/tmp/report.json'] }] },
      object_scope: { steps: [{ name: 'Object Scope', action: 'forensic_investigation', scope: { dir: '/workspaces' } }] }
    }
  };

  const engine = new DeclarativeWorkflowEngine(meta);

  for (const wfName of Object.keys(meta.workflows)) {
    await assert.rejects(
      async () => engine.executeWorkflow(wfName),
      /Zero Trust RBAC Policy Violation \[RBAC_TARGET_INVALID\]/,
      `Workflow '${wfName}' must fail closed with RBAC_TARGET_INVALID`
    );
  }
});

test('PR-003 Regression: capability adapters fail closed without simulation', async () => {
  const meta = {
    name: 'adapter-truth-persona',
    models: { default: { model: 'test' } },
    rbac: {
      role: 'adapter_role',
      permissions: {
        filesystem: { read: ['/workspaces', testIsolatedDir], write: ['/workspaces', testIsolatedDir] }
      }
    },
    workflows: {
      patch_without_content: {
        steps: [
          { name: 'Patch Target No Content', action: 'apply_fix_or_patch', target: path.join(testIsolatedDir, 'test.patch') }
        ]
      },
      invalid_sdmx_schema: {
        steps: [
          { name: 'Validate Missing Schema', action: 'validate_sdmx_schema', target: path.join(testIsolatedDir, 'missing_schema.json') }
        ]
      },
      unimplemented_model: {
        steps: [
          { name: 'Call Unknown Model', action: 'run_llm_query', model: 'definitely-not-called-model' }
        ]
      }
    }
  };

  const engine = new DeclarativeWorkflowEngine(meta);

  // 1. apply_fix_or_patch without content fails closed
  const patchRes = await engine.executeWorkflow('patch_without_content');
  assert.equal(patchRes.status, 'FAILED');
  assert.match(patchRes.error, /requires 'patch' or 'content'/);

  // 2. validate_sdmx_schema on missing file fails closed
  const schemaRes = await engine.executeWorkflow('invalid_sdmx_schema');
  assert.equal(schemaRes.status, 'FAILED');
  assert.match(schemaRes.error, /SDMX schema file not found/);

  // 3. run_llm_query with invalid model fails closed
  const llmRes = await engine.executeWorkflow('unimplemented_model');
  assert.equal(llmRes.status, 'FAILED');
  assert.match(llmRes.error, /unavailable/);
});

test('PR-007 Regression: runAgentWorkflow bridge reports failed execution as success: false', async () => {
  // Create a temporary persona fixture with a failing workflow
  const testPersonasDir = path.join(testIsolatedDir, 'personas');
  const fixtureDir = path.join(testPersonasDir, 'failing-bridge-persona');
  fs.mkdirSync(fixtureDir, { recursive: true });

  const manifest = `version: "1.0"
name: failing-bridge-persona
rbac:
  role: tester
  permissions:
    filesystem:
      read: ["/workspaces"]
      write: ["/workspaces"]
workflows:
  failing_wf:
    steps:
      - name: "Dead Port Probe"
        action: "probe_services"
        target: "http://127.0.0.1:9"
`;
  fs.writeFileSync(path.join(fixtureDir, 'persona.yaml'), manifest, 'utf8');

  const prevPersonasDir = process.env.DSH_PERSONAS_DIR;
  try {
    process.env.DSH_PERSONAS_DIR = testPersonasDir;
    const res = await runAgentWorkflow('failing-bridge-persona', 'failing_wf');
    assert.equal(res.success, false, 'runAgentWorkflow must return success: false when workflow execution fails');
    assert.equal(res.status, 'FAILED');
    assert.ok(res.error);
  } finally {
    process.env.DSH_PERSONAS_DIR = prevPersonasDir;
  }
});

test('PR-008 Regression: semantic failure invokes on_failure fallback and recovers', async () => {
  const fallbackMeta = {
    name: 'fallback-persona',
    models: { default: { model: 'test' } },
    rbac: {
      role: 'fallback_role',
      permissions: {
        filesystem: { read: ['/workspaces'], write: ['/workspaces'] }
      }
    },
    workflows: {
      semantic_fallback: {
        steps: [
          {
            name: 'Probe Dead Port With Fallback',
            action: 'probe_services',
            target: 'http://127.0.0.1:9',
            on_failure: 'parse_intent'
          }
        ]
      }
    }
  };

  const engine = new DeclarativeWorkflowEngine(fallbackMeta);
  const res = await engine.executeWorkflow('semantic_fallback');

  assert.equal(res.status, 'COMPLETED', 'Workflow must complete successfully when semantic failure triggers recovery fallback');
  assert.equal(res.executionLogs[0].status, 'SUCCESS');
  assert.equal(res.executionLogs[0].output.fallback_executed, 'parse_intent');
  assert.ok(res.executionLogs[0].output.original_error);
});

test('PR-009 Regression: approval gate creates durable checkpoint and resumes without replaying', async () => {
  let step1Executed = 0;
  let step2Executed = 0;

  const acmMeta = {
    name: 'acm-approval-persona',
    models: { default: { model: 'test' } },
    rbac: {
      role: 'acm_role',
      permissions: {
        filesystem: { read: ['/workspaces', testIsolatedDir], write: ['/workspaces', testIsolatedDir] }
      }
    },
    workflows: {
      approval_pipeline: {
        steps: [
          { name: 'Step 1 Pre-Gated Analysis', action: 'parse_intent' },
          { name: 'Step 2 Critical Containment', action: 'contain_threat', target: path.join(testIsolatedDir, 'cases', 'quarantine.json'), approval_required: true },
          { name: 'Step 3 Post-Gated Escalation', action: 'escalate_to_soc' }
        ]
      }
    }
  };

  const engine = new DeclarativeWorkflowEngine(acmMeta);

  // Initial run without approval
  const initialRes = await engine.executeWorkflow('approval_pipeline');
  assert.equal(initialRes.status, 'SUSPENDED_APPROVAL_REQUIRED');
  assert.ok(initialRes.instanceId, 'Must generate unique workflow instance ID');
  assert.ok(initialRes.approvalToken, 'Must generate HMAC approval decision token');
  assert.equal(initialRes.executionLogs.length, 2);
  assert.equal(initialRes.executionLogs[1].status, 'GATED');

  // Verify checkpoint was written to disk
  const checkpointFile = path.join(process.env.DSH_SESSIONS_DIR, 'checkpoints', `${initialRes.instanceId}.json`);
  assert.ok(fs.existsSync(checkpointFile), 'Checkpoint file must be persisted to sessions/checkpoints');
  const checkpoint = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
  assert.equal(checkpoint.instanceId, initialRes.instanceId);
  assert.equal(checkpoint.stepIndex, 1);

  // Resume the suspended workflow directly from Step 2
  const resumeRes = await engine.resumeWorkflow(initialRes.instanceId, { approved: true });
  assert.equal(resumeRes.status, 'COMPLETED');
  assert.equal(resumeRes.resumedFrom, initialRes.instanceId);
  assert.equal(resumeRes.executionLogs.length, 3);
  assert.equal(resumeRes.executionLogs[1].status, 'SUCCESS');
  assert.equal(resumeRes.executionLogs[2].status, 'SUCCESS');
});

test('PR-011 Regression: test execution leaves repository workspaces clean without mutation', () => {
  // Assert that no pi-ai.patch was created in repository cwd
  const repoCasesPatch = path.join(ROOT, 'workspaces', 'cases', 'pi-ai.patch');
  assert.equal(
    fs.existsSync(repoCasesPatch),
    false,
    'Orchestrator tests must not mutate git repository cwd workspaces/cases/pi-ai.patch'
  );
});

test('FR-004 Regression: failed fallback propagates failure and marks workflow as FAILED', async () => {
  const meta = {
    name: 'security-auditor',
    rbac: {
      role: 'security_auditor_role',
      permissions: {
        filesystem: {
          read: ['/workspaces', testIsolatedDir],
          write: ['/workspaces', testIsolatedDir]
        }
      }
    },
    workflows: {
      failed_fallback_test: {
        steps: [
          {
            name: 'Primary Probe with Failing Fallback',
            action: 'probe_services',
            target: 'http://127.0.0.1:99999',
            on_failure: 'inspect_sqlite'
          }
        ]
      }
    }
  };

  const engine = new DeclarativeWorkflowEngine(meta);
  const result = await engine.executeWorkflow('failed_fallback_test');
  assert.equal(result.status, 'FAILED');
  assert.equal(result.executionLogs.length, 1);
  assert.equal(result.executionLogs[0].status, 'FAILED');
  assert.ok(
    result.executionLogs[0].output.error.includes('Fallback') || (result.error && result.error.includes('Fallback')),
    'Step output error must record fallback failure'
  );
});

test('FR-005 Regression: checkpoint requires explicit approval, blocks unapproved resume, and prevents replay', async () => {
  const meta = {
    name: 'security-auditor',
    rbac: {
      role: 'security_auditor_role',
      permissions: {
        filesystem: {
          read: ['/workspaces', testIsolatedDir],
          write: ['/workspaces', testIsolatedDir]
        }
      }
    },
    workflows: {
      approval_replay_test: {
        steps: [
          { name: 'Step 1 Pre', action: 'fetch_sources', scope: testIsolatedDir },
          { name: 'Step 2 Gated', action: 'contain_threat', target: path.join(testIsolatedDir, 'cases', 'q.json'), approval_required: true },
          { name: 'Step 3 Post', action: 'write_report', destination: path.join(testIsolatedDir, 'cases', 'rep.md') }
        ]
      }
    }
  };

  const engine = new DeclarativeWorkflowEngine(meta);

  // 1. Fresh execution with ambient approved: true must still suspend
  const freshRes = await engine.executeWorkflow('approval_replay_test', { approved: true });
  assert.equal(freshRes.status, 'SUSPENDED_APPROVAL_REQUIRED');

  // 2. Resume without explicit approval must be rejected
  await assert.rejects(
    async () => engine.resumeWorkflow(freshRes.instanceId),
    /explicit human approval required/
  );

  // 3. Resume with explicit approval succeeds and completes
  const resumeRes = await engine.resumeWorkflow(freshRes.instanceId, { approved: true });
  assert.equal(resumeRes.status, 'COMPLETED');

  // 4. Subsequent resume of already completed instance must be rejected as replay
  await assert.rejects(
    async () => engine.resumeWorkflow(freshRes.instanceId, { approved: true }),
    /replays rejected/
  );
});

test('FR-003 Regression: capability adapters validate syntax, schemas, and persist SOC incidents', async () => {
  const meta = {
    name: 'security-auditor',
    rbac: {
      role: 'security_auditor_role',
      permissions: {
        filesystem: {
          read: ['/workspaces', testIsolatedDir],
          write: ['/workspaces', testIsolatedDir]
        }
      }
    },
    workflows: {
      truthful_adapters_test: {
        steps: [
          { name: 'Validate Bare Agency', action: 'validate_sdmx_schema', target: 'LU1' },
          {
            name: 'Apply Bad Syntax JS',
            action: 'apply_fix_or_patch',
            target: path.join(testIsolatedDir, 'bad.js'),
            content: 'function broken( { not valid js'
          },
          {
            name: 'Escalate SOC Incident',
            action: 'escalate_to_soc',
            target: path.join(testIsolatedDir, 'cases', 'soc_esc.json')
          }
        ]
      }
    }
  };

  const engine = new DeclarativeWorkflowEngine(meta);

  // 1. validate_sdmx_schema on bare LU1 without schema file fails closed
  const step1 = await engine.executeStep(meta.workflows.truthful_adapters_test.steps[0], {}, 'test', 'tr-1', 'sp-1');
  assert.equal(step1.status, 'failed');
  assert.equal(step1.code, 'SDMX_SCHEMA_NOT_FOUND');

  // 2. apply_fix_or_patch with invalid JS syntax fails closed
  const step2 = await engine.executeStep(meta.workflows.truthful_adapters_test.steps[1], {}, 'test', 'tr-2', 'sp-2');
  assert.equal(step2.status, 'failed');
  assert.equal(step2.code, 'SYNTAX_VERIFICATION_FAILED');

  // 3. escalate_to_soc persists durable ledger file on disk
  const step3 = await engine.executeStep(meta.workflows.truthful_adapters_test.steps[2], { error: 'Test threat' }, 'test', 'tr-3', 'sp-3');
  assert.equal(step3.status, 'success');
  assert.equal(step3.escalation.status, 'DISPATCHED');
  assert.ok(fs.existsSync(path.join(testIsolatedDir, 'cases', 'soc_esc.json')), 'SOC escalation file must be persisted');
});

test.after(() => {
  fs.rmSync(testIsolatedDir, { recursive: true, force: true });
});
