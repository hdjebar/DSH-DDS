import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DeclarativeWorkflowEngine,
  DEFAULT_GATED_ACTIONS
} from '../config/declarative-orchestrator.mjs';

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-step-gate-'));
process.env.DSH_SESSIONS_DIR = path.join(TEST_DIR, 'sessions');
process.env.DSH_AUDIT_LOG_FILE = path.join(TEST_DIR, 'audit_grc.jsonl');
process.env.DSH_AUDIT_INTEGRITY_KEY = 'step-gate-audit-key-32-bytes-long!';
test.after(() => fs.rmSync(TEST_DIR, { recursive: true, force: true }));

function baseMeta(workflows = {}) {
  return {
    name: 'security-auditor',
    rbac: {
      role: 'security_auditor',
      permissions: {
        filesystem: {
          read: ['/workspaces', TEST_DIR],
          write: ['/workspaces', TEST_DIR],
          deny: []
        },
        mcp: { allowed: [] }
      }
    },
    workflows
  };
}

test('write action without explicit gate defaults to gated (DEFAULT_GATED_ACTIONS)', async () => {
  const meta = baseMeta();
  const engine = new DeclarativeWorkflowEngine(meta);

  // For every default-gated action, undefined approval_required must gate
  for (const action of DEFAULT_GATED_ACTIONS) {
    const step = {
      name: `Ungated ${action}`,
      action,
      target: path.join(TEST_DIR, 'test_target.txt'),
      content: 'test content'
    };
    const res = await engine.executeStep(step, {}, 'test-wf', 'tr-gate-1', 'sp-gate-1');
    assert.equal(res.gated, true, `Action '${action}' must be gated by default when approval_required is undefined`);
    assert.match(res.reason, /Pending human-in-the-loop approval gate/);
  }

  // Explicit approval_required: false overrides default gate
  const ungatedStep = {
    name: 'Explicitly ungated',
    action: 'apply_fix_or_patch',
    target: path.join(TEST_DIR, 'explicit_ungated.js'),
    content: 'console.log("hello");\n',
    approval_required: false
  };
  const ungatedRes = await engine.executeStep(ungatedStep, {}, 'test-wf', 'tr-gate-2', 'sp-gate-2');
  assert.equal(ungatedRes.status, 'success');
});

test('gated step whose fallback must also gate suspends without running fallback ungated', async () => {
  const meta = baseMeta({
    'gated-with-gated-fallback': {
      steps: [
        {
          name: 'Primary failing step',
          action: 'apply_fix_or_patch',
          target: path.join(TEST_DIR, 'bad_syntax.js'),
          content: 'broken js ((((',
          approval_required: false,
          on_failure: 'contain_threat'
        }
      ]
    }
  });

  const engine = new DeclarativeWorkflowEngine(meta);
  const result = await engine.executeWorkflow('gated-with-gated-fallback');
  // Primary action fails semantic validation, triggers fallback 'contain_threat'.
  // 'contain_threat' is in DEFAULT_GATED_ACTIONS and has not been approved, so it gates!
  assert.equal(result.status, 'SUSPENDED_APPROVAL_REQUIRED');
  assert.match(result.suspendedReason, /requires approval before execution/);
});

test('alternating execution cycles (A,B,A,B) produce LOOP_DETECTED via bounded ring', async () => {
  const meta = baseMeta({
    'alternating-loop': {
      steps: [
        { name: 'Step A1', action: 'probe_services', target: 'https://example.com/a' },
        { name: 'Step B1', action: 'parse_intent', target: 'https://example.com/b' },
        { name: 'Step A2', action: 'probe_services', target: 'https://example.com/a' },
        { name: 'Step B2', action: 'parse_intent', target: 'https://example.com/b' }
      ]
    }
  });

  const engine = new DeclarativeWorkflowEngine(meta);
  engine.registerAction('probe_services', async () => ({ status: 'success' }));
  engine.registerAction('parse_intent', async () => ({ status: 'success' }));

  await assert.rejects(
    async () => engine.executeWorkflow('alternating-loop'),
    (err) => {
      assert.equal(err.code, 'LOOP_DETECTED');
      assert.match(err.message, /\[Agent Loop Trap\] Deterministic circular step detected/);
      return true;
    }
  );
});
