import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { DeclarativeWorkflowEngine, runAgentWorkflow, AgentPhoenixTracer } from '../config/declarative-orchestrator.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

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
            target: 'config/'
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

test('Declarative Orchestrator: intercepts RBAC violations and unauthorized write paths', async () => {
  const meta = {
    name: 'restricted-agent',
    rbac: {
      role: 'restricted',
      permissions: {
        filesystem: {
          read: ['/workspaces'],
          write: ['/workspaces/allowed'],
          deny: ['/etc', 'reset.sh']
        }
      }
    },
    workflows: {
      unauthorized_write: {
        steps: [
          {
            name: 'Write to Denied Host Script',
            action: 'write_report',
            destination: 'reset.sh'
          }
        ]
      },
      write_outside_allowlist: {
        steps: [
          {
            name: 'Write outside write perimeter',
            action: 'write_report',
            destination: '/var/unauthorized_output.json'
          }
        ]
      }
    }
  };

  const engine = new DeclarativeWorkflowEngine(meta);
  await assert.rejects(
    async () => {
      await engine.executeWorkflow('unauthorized_write');
    },
    /RBAC_DENY_VIOLATION/
  );

  await assert.rejects(
    async () => {
      await engine.executeWorkflow('write_outside_allowlist');
    },
    /RBAC_WRITE_UNAUTHORIZED/
  );
});

test('Declarative Orchestrator: evaluates Adaptive Case Management conditions and gates', async () => {
  const meta = {
    name: 'acm-agent',
    rbac: {
      role: 'acm_tester',
      permissions: {
        filesystem: { read: [ROOT], write: [ROOT], deny: [] }
      }
    },
    workflows: {
      conditional_wf: {
        steps: [
          {
            name: 'Step 1: Check Condition (Should Pass)',
            action: 'parse_intent',
            when: "status == 'ACTIVE'"
          },
          {
            name: 'Step 2: Check Condition (Should Skip)',
            action: 'parse_intent',
            when: "status == 'INACTIVE'"
          },
          {
            name: 'Step 3: Approval Gate (Pending)',
            action: 'parse_intent',
            approval_required: true
          }
        ]
      }
    }
  };

  const engine = new DeclarativeWorkflowEngine(meta);
  const result = await engine.executeWorkflow('conditional_wf', { status: 'ACTIVE' });

  assert.equal(result.executionLogs[0].status, 'SUCCESS');
  assert.equal(result.executionLogs[1].status, 'SKIPPED');
  assert.equal(result.executionLogs[2].status, 'GATED');
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
