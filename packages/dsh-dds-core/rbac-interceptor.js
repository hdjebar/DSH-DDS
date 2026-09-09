/**
 * Zero-Trust Tool Interceptor (PEP) for @dsh-dds/core
 *
 * Provides in-line authorization evaluation for agent tool executions,
 * enforcing directory boundary containment and recording immutable GRC audit events.
 */

import path from 'path';
import fs from 'fs';
import crypto from 'node:crypto';
import { UserPartitionManager } from './user-partition.js';
import { DEFAULT_OPERATOR } from './iam.js';
import { issueExecutionCapability, runWithExecutionCapability } from './execution-capability.js';

let rbacEngine = null;

async function getRbacEngine() {
  if (rbacEngine) return rbacEngine;
  const candidates = [
    '../../config/persona.mjs',
    '/etc/dsh/persona.mjs',
    '/var/lib/dsh/persona.mjs',
    '/opt/dsh-config/persona.mjs'
  ];
  for (const candidate of candidates) {
    try {
      const mod = await import(candidate);
      if (mod && typeof mod.enforceRbacPolicy === 'function') {
        rbacEngine = mod;
        return rbacEngine;
      }
    } catch {}
  }
  return null;
}

export const TOOL_ACTION_MAP = Object.assign(Object.create(null), {
  bash: 'run_shell',
  sh: 'run_shell',
  shell: 'run_shell',
  exec: 'run_shell',
  terminal: 'run_shell',
  execute_command: 'run_shell',
  run_shell: 'run_shell',
  read_file: 'read_file',
  read: 'read_file',
  cat: 'read_file',
  view_file: 'read_file',
  glob: 'read_file',
  grep: 'read_file',
  write: 'create_file',
  write_file: 'create_file',
  create_file: 'create_file',
  edit: 'modify_file',
  edit_file: 'modify_file',
  modify_file: 'modify_file',
  save_artifact: 'save_artifact',
  fetch: 'fetch_sources',
  fetch_sources: 'fetch_sources',
  mcp_fetch: 'fetch_sources',
  web_search: 'fetch_sources',
  sqlite: 'inspect_sqlite',
  sqlite_query: 'inspect_sqlite',
  inspect_sqlite: 'inspect_sqlite',
  tabular: 'inspect_tabular',
  inspect_tabular: 'inspect_tabular'
});

export const KNOWN_POLICY_VERBS = new Set([
  'write_report', 'apply_fix_or_patch', 'save_artifact',
  'create_file', 'contain_threat', 'modify_file', 'escalate_to_soc',
  'run_shell', 'fetch_sources', 'inspect_sqlite', 'read_catalog',
  'forensic_investigation', 'inspect_tabular', 'read_file',
  'validate_sdmx_schema', 'run_llm_query', 'parse_intent',
  'evaluate_incident', 'probe_services', 'verify_endpoint',
  'fetch_sdmx_dataflows'
]);

export function registerRbacInterceptor(ctx, config = {}) {
  if (config.enableToolRbac === false) return;

  const partitionManager = new UserPartitionManager(config);
  const authEnabled = config.authEnabled ?? (process.env.DSH_AUTH_ENABLE === 'true');

  const resolveUser = (explicitUser) => {
    if (explicitUser) return explicitUser;
    try {
      const iam = typeof ctx.get === 'function' ? ctx.get('iam') : ctx.iam;
      if (iam && typeof iam.getCurrentUser === 'function') {
        return iam.getCurrentUser();
      }
    } catch {}
    return authEnabled ? null : DEFAULT_OPERATOR;
  };

  const handler = async (actionContext) => {
    const user = resolveUser(actionContext.user);
    if (!user) {
      throw new Error('[Zero-Trust RBAC Violation] Missing authenticated user identity context');
    }

    const resolvedAction = (actionContext.toolName && TOOL_ACTION_MAP[actionContext.toolName])
      ?? (actionContext.action && TOOL_ACTION_MAP[actionContext.action])
      ?? (KNOWN_POLICY_VERBS.has(actionContext.action) ? actionContext.action : null);

    if (!resolvedAction) {
      throw new Error(`[Zero-Trust RBAC Violation] Action '${actionContext.toolName || actionContext.action || 'unknown'}' is an unmapped or unauthorized tool`);
    }

    const isShellAction = resolvedAction === 'run_shell';
    const isolatedExecutorEnabled = process.env.DSH_EXECUTOR_MODE === 'isolated';
    if (isShellAction && !isolatedExecutorEnabled && (process.env.DSH_ALLOW_UNCONFINED_SHELL !== '1' || process.env.DSH_SANDBOX === '1')) {
      throw new Error(
        '[Zero-Trust RBAC Violation] Unconfined shell execution is disabled. '
        + 'DSH_ALLOW_UNCONFINED_SHELL=1 is a temporary trusted single-operator escape hatch and is forbidden in sandbox mode.'
      );
    }
    const targetPath = actionContext.target || actionContext.path || (isShellAction ? (actionContext.workdir || actionContext.cwd || (process.env.DSH_WORKSPACE_ROOT ? path.join(process.env.DSH_WORKSPACE_ROOT, 'cases') : '/workspaces/cases')) : null);

    const step = {
      name: actionContext.toolName || 'tool-execute',
      action: resolvedAction,
      target: targetPath,
      command: actionContext.command,
      workdir: actionContext.workdir || actionContext.cwd
    };

    const resolveEngine = async () => (config.getRbacEngine ? await config.getRbacEngine() : (config.rbacEngine || await getRbacEngine()));

    // Correlate the JSONL record with its Phoenix span. Without this the PEP writes
    // trace_id: null and emitGrcSpanToPhoenix falls back to a millisecond timestamp,
    // which is neither unique under concurrency nor joinable with the LLM spans.
    const traceId = actionContext.traceId
      || actionContext.trace_id
      || crypto.randomBytes(16).toString('hex');

    // Multi-tenant scoped workspace boundary evaluation
    if (step.target && typeof step.target === 'string') {
      const tenantCheck = partitionManager.validatePathAccess(step.target, user);
      if (!tenantCheck.allowed) {
        try {
          const engine = await resolveEngine();
          const auditFn = (engine && typeof engine.logGrcAuditEventBestEffort === 'function')
            ? engine.logGrcAuditEventBestEffort.bind(engine)
            : (engine && typeof engine.logGrcAuditEvent === 'function' ? engine.logGrcAuditEvent.bind(engine) : null);
          if (auditFn) {
            auditFn({
              persona: actionContext.persona?.name || 'default',
              workflow: actionContext.workflow || 'agent-session',
              action: step.action,
              target: step.target,
              decision: 'DENIED',
              role: user.roles?.[0] || 'user',
              reason: tenantCheck.reason
            }, traceId);
          }
        } catch {}
        throw new Error(`[Zero-Trust RBAC Violation] ${tenantCheck.reason}`);
      }
    }

    const engine = await resolveEngine();
    if (!engine || typeof engine.enforceRbacPolicy !== 'function') {
      throw new Error('[Zero-Trust RBAC Violation] Policy engine unavailable');
    }

    const readRoots = ['/workspaces', '/var/lib/dsh'];
    const writeRoots = ['/workspaces/cases', '/var/lib/dsh/sessions', '/var/lib/dsh/storages'];
    if (config.workspaceBase) {
      readRoots.push(config.workspaceBase);
      writeRoots.push(config.workspaceBase);
    }
    if (config.userStateBase) {
      readRoots.push(config.userStateBase);
      writeRoots.push(config.userStateBase);
    }

    const personaMeta = actionContext.persona || {
      name: 'default',
      rbac: {
        role: 'default',
        permissions: {
          filesystem: {
            read: readRoots,
            write: writeRoots,
            deny: ['/etc', '/root/.ssh', 'reset.sh', 'install_dsh.sh']
          }
        }
      }
    };

    const decision = engine.enforceRbacPolicy(personaMeta, step);
    if (!decision.allowed) {
      // The action is refused regardless; an audit-sink failure must not mask the
      // policy violation that the caller needs to see.
      try {
        const auditFn = typeof engine.logGrcAuditEventBestEffort === 'function'
          ? engine.logGrcAuditEventBestEffort.bind(engine)
          : (typeof engine.logGrcAuditEvent === 'function' ? engine.logGrcAuditEvent.bind(engine) : null);
        if (auditFn) {
          auditFn({
            persona: personaMeta.name,
            workflow: actionContext.workflow || 'agent-session',
            action: step.action,
            target: step.target,
            decision: 'DENIED',
            role: decision.role,
            reason: decision.violation
          }, traceId);
        }
      } catch {}
      throw new Error(`[Zero-Trust RBAC Violation] ${decision.violation}`);
    }

    if (typeof engine.logGrcAuditEvent === 'function') {
      engine.logGrcAuditEvent({
        persona: personaMeta.name,
        workflow: actionContext.workflow || 'agent-session',
        action: step.action,
        target: step.target,
        decision: 'GRANTED',
        role: decision.role,
        reason: 'Policy check passed'
      }, traceId);
    }

    // Authorization must complete (including its fail-closed audit write) before
    // creating a caller-controlled workdir. Denied requests must have no filesystem
    // side effects.
    if (actionContext.workdir && !fs.existsSync(actionContext.workdir)) {
      try {
        fs.mkdirSync(actionContext.workdir, { recursive: true, mode: 0o770 });
        if (isolatedExecutorEnabled) fs.chmodSync(actionContext.workdir, 0o770);
      } catch {}
    }

    if (isShellAction && isolatedExecutorEnabled) {
      return {
        ...decision,
        executionCapability: issueExecutionCapability({ user, workdir: step.workdir || step.target })
      };
    }
    return decision;
  };

  // Authoritative Cordis Waterfall Hook for DeepSeek Harness tool execution pipeline
  const preExecuteWaterfall = async (exec, next) => {
    try {
      // If called with an actionContext object directly (e.g. from unit tests)
      if (!exec || (!exec.arguments && (exec.toolName || exec.action))) {
        return await handler(exec);
      }

      const rawArgs = exec.arguments || {};
      const isShell = exec.name === 'bash' || exec.name === 'sh' || exec.name === 'terminal' || exec.name === 'exec';
      const targetPath = rawArgs.file_path || rawArgs.path || rawArgs.target || rawArgs.target_path || rawArgs.filePath
        || (isShell ? (rawArgs.workdir || rawArgs.cwd || (process.env.DSH_WORKSPACE_ROOT ? path.join(process.env.DSH_WORKSPACE_ROOT, 'cases') : '/workspaces/cases')) : null);

      const actionContext = {
        toolName: exec.name,
        action: TOOL_ACTION_MAP[exec.name] || exec.name,
        target: targetPath,
        command: rawArgs.command || rawArgs.cmd,
        workdir: rawArgs.workdir || rawArgs.cwd,
        user: resolveUser(exec.user),
        traceId: exec.callId || exec.traceId || (exec.signal && exec.signal.traceId),
        persona: exec.persona || exec.agent?.persona
      };

      const decision = await handler(actionContext);
      if (typeof next !== 'function') return { kind: 'allow' };
      if (decision.executionCapability) {
        return await runWithExecutionCapability(decision.executionCapability, next);
      }
      return await next();
    } catch (err) {
      if (typeof next === 'function') {
        return { kind: 'deny', reason: err.message };
      }
      throw err;
    }
  };

  // Intercept tool executions in real time
  if (typeof ctx.on === 'function') {
    ctx.on('tools/pre-execute', preExecuteWaterfall);
    ctx.on('before/tool-execute', (ctxOrExec) => preExecuteWaterfall(ctxOrExec));
    ctx.on('tool-execute', (ctxOrExec) => preExecuteWaterfall(ctxOrExec));
  }
  if (Reflect.has(ctx, 'before') && typeof ctx.before === 'function') {
    ctx.before('tool-execute', (ctxOrExec) => preExecuteWaterfall(ctxOrExec));
  }
}
