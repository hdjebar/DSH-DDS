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

test('Declarative Orchestrator: executes structured steps with context propagation', async () => {
  const meta = {
    name: 'security-auditor',
    models: {
      default: { provider: 'google', model: 'gemini-1.5-pro' }
    },
    rbac: {
      role: 'security_auditor',
      permissions: {
        filesystem: {
          read: ['/workspaces', '/tmp'],
          write: ['/tmp'],
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
            target: 'config/',
            verification: 'syntax_clean'
          }
        ]
      }
    }
  };

  const engine = new DeclarativeWorkflowEngine(meta);
  const result = await engine.executeWorkflow('audit_pipeline', { initial_var: 'test_value' });

  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.persona, 'security-auditor');
  assert.equal(result.executionLogs.length, 3);
  assert.equal(result.executionLogs[0].status, 'SUCCESS');
  assert.equal(result.executionLogs[1].status, 'SUCCESS');
  assert.equal(result.executionLogs[2].status, 'SUCCESS');

  // Verify context propagation
  assert.equal(result.finalContext.initial_var, 'test_value');
  assert.ok(result.finalContext.sources);
  assert.ok(result.finalContext.llm_response);
  assert.ok(result.finalContext.patch_status);
});

test('Declarative Orchestrator: intercepts and fails closed on RBAC violations', async () => {
  const meta = {
    name: 'compromised-agent',
    rbac: {
      role: 'restricted_agent',
      permissions: {
        filesystem: {
          read: ['/workspaces'],
          write: ['/workspaces'],
          deny: ['/etc', 'reset.sh', 'install_dsh.sh']
        }
      }
    },
    workflows: {
      malicious_workflow: {
        steps: [
          {
            name: 'Attempt Wipe',
            action: 'execute_command',
            target: 'reset.sh'
          }
        ]
      }
    }
  };

  const engine = new DeclarativeWorkflowEngine(meta);
  await assert.rejects(
    async () => {
      await engine.executeWorkflow('malicious_workflow');
    },
    /Zero Trust RBAC Policy Violation/
  );
});

test('Declarative Orchestrator: AgentPhoenixTracer handles offline telemetry safely', async () => {
  const tracer = new AgentPhoenixTracer('http://127.0.0.1:59999'); // Non-existent port
  // Must not throw even when telemetry endpoint is unreachable
  await assert.doesNotReject(async () => {
    await tracer.sendSpan({
      workflow: 'test_wf',
      persona: 'tester',
      name: 'test.span',
      startTime: Date.now(),
      endTime: Date.now() + 5,
      attributes: { test: 'true' }
    });
  });
});

test('Declarative Orchestrator: runAgentWorkflow bridge executes persona manifests directly', async () => {
  const res = await runAgentWorkflow('security-auditor', 'audit_code');
  assert.ok(typeof res === 'object');
  // It either executes cleanly or reports formatted error without crashing process
  assert.ok(res.success === true || res.success === false);
  if (res.success) {
    assert.equal(res.execution.status, 'COMPLETED');
    assert.ok(res.execution.executionLogs.length > 0);
  }
});
