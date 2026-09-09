import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeclarativeWorkflowEngine } from '../config/declarative-orchestrator.mjs';

function createEngineWithDeterministicProbe(meta) {
  const engine = new DeclarativeWorkflowEngine(meta);
  engine.registerAction('probe_services', async (step) => ({
    status: 'success',
    service_probe: {
      target: step.target,
      reachable: true,
      status_code: 200
    }
  }));
  return engine;
}

test('Loop Trap (Invariant 7): allows distinct sequential steps without false positives', async () => {
  const meta = {
    name: 'test-persona',
    rbac: {
      role: 'admin',
      permissions: {
        filesystem: {
          read: ['/workspaces'],
          write: ['/workspaces']
        }
      }
    },
    workflows: {
      'distinct-steps': {
        steps: [
          { name: 'Step 1', action: 'probe_services', target: 'https://example.com/api/v1' },
          { name: 'Step 2', action: 'probe_services', target: 'https://example.com/api/v2' }
        ]
      }
    }
  };

  const engine = createEngineWithDeterministicProbe(meta);
  const result = await engine.executeWorkflow('distinct-steps');
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.executionLogs.length, 2);
  assert.equal(result.executionLogs[0].status, 'SUCCESS');
  assert.equal(result.executionLogs[1].status, 'SUCCESS');
});

test('Loop Trap (Invariant 7): deterministically rejects consecutive identical step calls with LOOP_DETECTED', async () => {
  const meta = {
    name: 'test-persona',
    rbac: {
      role: 'admin',
      permissions: {
        filesystem: {
          read: ['/workspaces'],
          write: ['/workspaces']
        }
      }
    },
    workflows: {
      'infinite-loop': {
        steps: [
          { name: 'Same Step First', action: 'probe_services', target: 'https://example.com/health' },
          { name: 'Same Step Second', action: 'probe_services', target: 'https://example.com/health' }
        ]
      }
    }
  };

  const engine = createEngineWithDeterministicProbe(meta);
  await assert.rejects(async () => {
    await engine.executeWorkflow('infinite-loop');
  }, (err) => {
    assert.match(err.message, /\[Agent Loop Trap\] Deterministic circular step detected/);
    assert.equal(err.code, 'LOOP_DETECTED');
    return true;
  });
});

test('Loop Trap (Invariant 7): loop detection triggers on_failure fallback recovery', async () => {
  const meta = {
    name: 'test-persona',
    rbac: {
      role: 'admin',
      permissions: {
        filesystem: {
          read: ['/workspaces'],
          write: ['/workspaces']
        }
      }
    },
    workflows: {
      'loop-with-fallback': {
        steps: [
          { name: 'Step 1', action: 'probe_services', target: 'https://example.com/health' },
          {
            name: 'Step 2 (Trapped)',
            action: 'probe_services',
            target: 'https://example.com/health',
            on_failure: 'parse_intent'
          }
        ]
      }
    }
  };

  const engine = createEngineWithDeterministicProbe(meta);
  const result = await engine.executeWorkflow('loop-with-fallback');
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.executionLogs.length, 2);
  assert.equal(result.executionLogs[1].output.status, 'recovered');
  assert.equal(result.executionLogs[1].output.fallback_executed, 'parse_intent');
});
