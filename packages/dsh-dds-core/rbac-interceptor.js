/**
 * Zero-Trust Tool Interceptor (PEP) for @dsh-dds/core
 *
 * Provides in-line authorization evaluation for agent tool executions,
 * enforcing directory boundary containment and recording immutable GRC audit events.
 */

import path from 'path';
import fs from 'fs';
import { UserPartitionManager } from './user-partition.js';

let rbacEngine = null;

async function getRbacEngine() {
  if (rbacEngine) return rbacEngine;
  try {
    const personaMod = await import('../../config/persona.mjs');
    rbacEngine = personaMod;
    return rbacEngine;
  } catch {
    try {
      const altMod = await import('/etc/dsh/persona.mjs');
      rbacEngine = altMod;
      return rbacEngine;
    } catch {
      return null;
    }
  }
}

export const TOOL_ACTION_MAP = {
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
};

export function registerRbacInterceptor(ctx, config = {}) {
  if (config.enableToolRbac === false) return;

  const partitionManager = new UserPartitionManager(config);

  const handler = async (actionContext) => {
    if (actionContext.workdir && !fs.existsSync(actionContext.workdir)) {
      try { fs.mkdirSync(actionContext.workdir, { recursive: true }); } catch {}
    }

    const user = actionContext.user || ctx.user;
    if (!user) {
      throw new Error('[Zero-Trust RBAC Violation] Missing authenticated user identity context');
    }

    const resolvedAction = TOOL_ACTION_MAP[actionContext.action]
      || actionContext.action
      || TOOL_ACTION_MAP[actionContext.toolName]
      || null;

    if (!resolvedAction) {
      throw new Error(`[Zero-Trust RBAC Violation] Action '${actionContext.toolName || 'unknown'}' is an unmapped or unauthorized tool`);
    }

    const step = {
      name: actionContext.toolName || 'tool-execute',
      action: resolvedAction,
      target: actionContext.target || actionContext.path || actionContext.command
    };

    // Multi-tenant scoped workspace boundary evaluation
    if (step.target && typeof step.target === 'string') {
      const tenantCheck = partitionManager.validatePathAccess(step.target, user);
      if (!tenantCheck.allowed) {
        const engine = await getRbacEngine();
        if (engine && typeof engine.logGrcAuditEvent === 'function') {
          engine.logGrcAuditEvent({
            persona: actionContext.persona?.name || 'default',
            workflow: actionContext.workflow || 'agent-session',
            action: step.action,
            target: step.target,
            decision: 'DENIED',
            role: user.roles?.[0] || 'user',
            reason: tenantCheck.reason
          });
        }
        throw new Error(`[Zero-Trust RBAC Violation] ${tenantCheck.reason}`);
      }
    }

    const engine = await getRbacEngine();
    if (!engine || typeof engine.enforceRbacPolicy !== 'function') return;

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
      if (typeof engine.logGrcAuditEvent === 'function') {
        engine.logGrcAuditEvent({
          persona: personaMeta.name,
          workflow: actionContext.workflow || 'agent-session',
          action: step.action,
          target: step.target,
          decision: 'DENIED',
          role: decision.role,
          reason: decision.violation
        });
      }
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
      });
    }
  };

  // Intercept tool executions if before or event hooks exist
  if (Reflect.has(ctx, 'before') && typeof ctx.before === 'function') {
    ctx.before('tool-execute', handler);
  }
  if (typeof ctx.on === 'function') {
    ctx.on('before/tool-execute', handler);
    ctx.on('tool-execute', handler);
  }
}
