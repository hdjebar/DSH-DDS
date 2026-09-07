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

export function registerRbacInterceptor(ctx, config = {}) {
  if (config.enableToolRbac === false) return;

  const partitionManager = new UserPartitionManager(config);

  const handler = async (actionContext) => {
    if (actionContext.workdir && !fs.existsSync(actionContext.workdir)) {
      try { fs.mkdirSync(actionContext.workdir, { recursive: true }); } catch {}
    }

    const user = actionContext.user || ctx.user || { id: 'default', roles: ['admin'] };
    const step = {
      name: actionContext.toolName || 'tool-execute',
      action: actionContext.action || 'execute',
      target: actionContext.target || actionContext.path || actionContext.command
    };

    // Multi-tenant scoped workspace boundary evaluation
    if (step.target && typeof step.target === 'string' && (step.target.startsWith('/') || step.target.startsWith('.'))) {
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
