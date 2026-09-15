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
    '../../config/rbac-policy.mjs',
    '/opt/dsh-config/rbac-policy.mjs',
    '/etc/dsh/rbac-policy.mjs',
    '/var/lib/dsh/rbac-policy.mjs'
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
  web_fetch: 'fetch_sources',
  read_page: 'fetch_sources',
  mcp_fetch: 'fetch_sources',
  web_search: 'fetch_sources',
  find_tools: 'fetch_sources',
  describe_tool: 'fetch_sources',
  execute_tool: 'fetch_sources',
  agentkey_account: 'fetch_sources',
  agentkey_skill_meta: 'fetch_sources',
  sqlite: 'inspect_sqlite',
  sqlite_query: 'inspect_sqlite',
  inspect_sqlite: 'inspect_sqlite',
  tabular: 'inspect_tabular',
  inspect_tabular: 'inspect_tabular',
  session_list: 'parse_intent',
  session_read: 'parse_intent',
  session_history: 'parse_intent',
  session_fork: 'parse_intent',
  mnemon_status: 'parse_intent',
  mnemon_recall: 'parse_intent',
  mnemon_runtime_memory: 'parse_intent',
  mnemon_document_search: 'parse_intent',
  mnemon_memory_bodies: 'parse_intent',
  mnemon_document_manage: 'parse_intent',
  mnemon_remember: 'parse_intent',
  mnemon_memory_body_create: 'parse_intent',
  mnemon_memory_body_update: 'parse_intent',
  mnemon_memory_body_merge: 'parse_intent',
  ask_user_question: 'parse_intent',
  create_goal: 'parse_intent',
  get_goal: 'parse_intent',
  update_goal: 'parse_intent',
  list_agents: 'parse_intent',
  interrupt_agent: 'parse_intent',
  send_message: 'parse_intent',
  job_list: 'parse_intent',
  job_output: 'parse_intent',
  job_kill: 'parse_intent',
  find_dsh_plugin: 'parse_intent',
  dsh_plugin: 'parse_intent',
  dshmarket: 'parse_intent',
  plugin_search: 'fetch_sources',
  plugin_list: 'read_file',
  plugin_install: 'apply_fix_or_patch',
  plugin_add: 'apply_fix_or_patch',
  plugin_remove: 'apply_fix_or_patch',
  market_search: 'fetch_sources',
  market_install: 'apply_fix_or_patch',
  exit_plan_mode: 'parse_intent',
  flow_create: 'parse_intent',
  flow_read: 'parse_intent',
  flow_list: 'parse_intent',
  flow_evaluate: 'parse_intent',
  flow_delete: 'parse_intent',
  flow_put: 'parse_intent',
  flow_finalize_canvas: 'parse_intent'
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

export async function bootstrapRbac(ctx, config = {}) {
  if (ctx?.__dds_rbac_bootstrapped) {
    return ctx.__dds_rbac_engine;
  }
  const resolveEngine = async () => (
    config.getRbacEngine
      ? await config.getRbacEngine()
      : (config.rbacEngine || await getRbacEngine())
  );
  const engine = await resolveEngine();
  if (config.enableToolRbac !== false) {
    if (!engine || typeof engine.enforceRbacPolicy !== 'function') {
      throw new Error('[Zero-Trust RBAC Violation] Deterministic boot assertion failed: RBAC policy engine could not be resolved (fail-closed)');
    }
  }
  if (ctx) {
    ctx.__dds_rbac_bootstrapped = true;
    ctx.__dds_rbac_engine = engine;
  }
  return engine;
}

export function registerRbacInterceptor(ctx, config = {}) {
  if (config.enableToolRbac === false) return;
  if (ctx?.__dds_rbac_registered) return;
  if (ctx) ctx.__dds_rbac_registered = true;

  bootstrapRbac(ctx, config).catch((err) => {
    console.error('❌ [@dsh-dds/core] Fatal RBAC bootstrap failure:', err.message);
  });

  if (typeof ctx?.on === 'function') {
    ctx.on('ready', async () => {
      await bootstrapRbac(ctx, config);
    });
  }

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

    let resolvedAction = (actionContext.toolName && TOOL_ACTION_MAP[actionContext.toolName])
      ?? (actionContext.action && TOOL_ACTION_MAP[actionContext.action])
      ?? (KNOWN_POLICY_VERBS.has(actionContext.action) ? actionContext.action : null);

    if (!resolvedAction && actionContext.toolName) {
      if (actionContext.toolName.startsWith('mcp__')) {
        const parts = actionContext.toolName.split('__');
        resolvedAction = 'mcp:' + parts[1];
      } else if (actionContext.toolName.startsWith('mcp:')) {
        resolvedAction = actionContext.toolName;
      } else if (actionContext.toolName.startsWith('mcp_')) {
        resolvedAction = 'mcp:' + actionContext.toolName.slice(4);
      } else if (actionContext.toolName.includes(':')) {
        const [ns] = actionContext.toolName.split(':');
        resolvedAction = 'mcp:' + ns;
      } else if (actionContext.toolName.includes('__')) {
        const [ns] = actionContext.toolName.split('__');
        resolvedAction = 'mcp:' + ns;
      }
    }

    if (!resolvedAction) {
      if (actionContext.persona?.rbac?.permissions?.tools?.includes('*') || actionContext.persona?.rbac?.permissions?.tools?.includes(actionContext.toolName || actionContext.action)) {
        resolvedAction = actionContext.toolName || actionContext.action;
      } else {
        throw new Error(`[Zero-Trust RBAC Violation] Action '${actionContext.toolName || actionContext.action || 'unknown'}' is an unmapped or unauthorized tool`);
      }
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
    const isUrl = (p) => typeof p === 'string' && (p.startsWith('http://') || p.startsWith('https://'));
    if (step.target && typeof step.target === 'string' && !isUrl(step.target)) {
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

    const engine = ctx?.__dds_rbac_engine || await resolveEngine();
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
          },
          mcp: {
            allowed: ['fetch', 'context7', 'github', 'sqlite-db', 'sdmx', 'orchestrator']
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
      const targetPath = rawArgs.file_path || rawArgs.path || rawArgs.target || rawArgs.target_path || rawArgs.filePath || rawArgs.url
        || (isShell ? (rawArgs.workdir || rawArgs.cwd || (process.env.DSH_WORKSPACE_ROOT ? path.join(process.env.DSH_WORKSPACE_ROOT, 'cases') : '/workspaces/cases')) : null);

      const actionContext = {
        toolName: exec.name,
        action: TOOL_ACTION_MAP[exec.name] || exec.name,
        target: targetPath || null,
        command: rawArgs.command || rawArgs.cmd,
        workdir: rawArgs.workdir || rawArgs.cwd,
        user: resolveUser(exec.user),
        traceId: exec.callId || exec.traceId || (exec.signal && exec.signal.traceId),
        persona: exec.persona || exec.agent?.persona
      };

      const decision = await handler(actionContext);
      if (decision.executionCapability && exec && typeof exec === 'object') {
        exec.__dds_capability = decision.executionCapability;
      }
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
    ctx.on('tools/execute', async (exec, next) => {
      const cap = exec?.__dds_capability || exec?.executionCapability || exec?.arguments?.executionCapability;
      if (cap && typeof next === 'function') {
        return await runWithExecutionCapability(cap, next);
      }
      return typeof next === 'function' ? await next() : undefined;
    });
    ctx.on('before/tool-execute', (ctxOrExec) => preExecuteWaterfall(ctxOrExec));
    ctx.on('tool-execute', (ctxOrExec) => preExecuteWaterfall(ctxOrExec));
  }
  if (Reflect.has(ctx, 'before') && typeof ctx.before === 'function') {
    ctx.before('tool-execute', (ctxOrExec) => preExecuteWaterfall(ctxOrExec));
  }
}
