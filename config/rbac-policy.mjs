#!/usr/bin/env node

/**
 * 🛡️ Zero Trust RBAC Policy Engine & Governance Audit Logger
 *
 * Provides strict directory boundary path containment, read/write allowlists,
 * symlink resolution, fail-closed contract enforcement, and non-repudiable
 * audit trail emission with OpenTelemetry trace correlation.
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function getYamlEngine() {
  try {
    return require('yaml');
  } catch {
    try {
      return require('/usr/local/lib/node_modules/yaml');
    } catch {
      return null;
    }
  }
}

const YAML = getYamlEngine();

export function validateSlug(val, label = 'identifier') {
  if (!val || typeof val !== 'string') {
    throw new Error(`Invalid ${label}: must be a non-empty string`);
  }
  const clean = val.trim();
  if (!/^[a-z0-9-_]+$/i.test(clean)) {
    throw new Error(`Invalid ${label} '${clean}': only alphanumeric characters, dashes, and underscores are allowed`);
  }
  return clean;
}

export function parseYaml(yamlText) {
  if (typeof yamlText !== 'string' || !yamlText.trim()) return {};
  try {
    if (YAML && typeof YAML.parse === 'function') {
      return YAML.parse(yamlText) || {};
    }
    throw new Error('YAML parser library not initialized');
  } catch (err) {
    console.error('YAML parse error:', err.message);
    return {};
  }
}

export function parsePersonaYaml(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const doc = parseYaml(content);

  const result = {
    name: doc.name || path.basename(path.dirname(filePath)),
    title: doc.title || doc.name || '',
    description: doc.description || '',
    profiles: Array.isArray(doc.profiles) ? doc.profiles : (doc.profiles && typeof doc.profiles === 'object' ? Object.keys(doc.profiles) : ['web', 'headless', 'cli']),
    models: {},
    rbac: doc.rbac || null,
    workflows: doc.workflows || {},
    plugins: doc.plugins || [],
    mcpServers: doc.mcpServers || {}
  };

  if (doc.models && typeof doc.models === 'object') {
    for (const [tier, cfg] of Object.entries(doc.models)) {
      if (cfg && typeof cfg === 'object') {
        result.models[tier] = {
          provider: cfg.provider || 'openrouter',
          model: cfg.model || 'deepseek/deepseek-chat',
          temperature: typeof cfg.temperature === 'number' ? cfg.temperature : (parseFloat(cfg.temperature) || 0.2),
          useCase: cfg.useCase || ''
        };
      }
    }
  }

  if (!result.models.default) {
    result.models.default = {
      provider: doc.provider || 'openrouter',
      model: doc.model || 'deepseek/deepseek-chat'
    };
  }

  return result;
}

/**
 * Canonical path resolver.
 * In container: resolves natively (e.g. /workspaces/..., /root/.dsh/...).
 * On host: transparently maps Docker volume mount roots (/workspaces -> ./workspaces, /root/.dsh -> ./config)
 * preventing path divergence, confused deputies, or silent redirection to /tmp.
 */
export function resolvePath(candidatePath) {
  if (!candidatePath || typeof candidatePath !== 'string') return process.cwd();
  const clean = candidatePath.trim().replace(/^["']|["']$/g, '');

  if (fs.existsSync('/workspaces') || fs.existsSync('/root/.dsh')) {
    return path.resolve(clean);
  }

  if (clean === '/workspaces' || clean.startsWith('/workspaces/')) {
    const rel = clean === '/workspaces' ? '' : clean.slice('/workspaces/'.length);
    return path.resolve(process.cwd(), 'workspaces', rel);
  }

  if (clean === '/root/.dsh' || clean.startsWith('/root/.dsh/')) {
    const rel = clean === '/root/.dsh' ? '' : clean.slice('/root/.dsh/'.length);
    if (process.env.DSH_RUNTIME_DIR) {
      return path.resolve(process.env.DSH_RUNTIME_DIR, rel);
    }
    return path.resolve(process.cwd(), 'config', rel);
  }

  return path.resolve(clean);
}

/**
/**
 * Canonicalize path resolving realpath for nearest existing ancestor directory
 * if the full target does not exist yet on disk.
 */
export function canonicalizeWithAncestorRealpath(targetPath) {
  const resolved = resolvePath(targetPath);
  if (fs.existsSync(resolved)) {
    try {
      return fs.realpathSync(resolved);
    } catch {
      return resolved;
    }
  }

  let current = path.dirname(resolved);
  const remaining = [path.basename(resolved)];

  while (current && current !== path.dirname(current)) {
    if (fs.existsSync(current)) {
      try {
        const canonicalAncestor = fs.realpathSync(current);
        return path.join(canonicalAncestor, ...remaining);
      } catch {
        return resolved;
      }
    }
    remaining.unshift(path.basename(current));
    current = path.dirname(current);
  }
  return resolved;
}

/**
 * Check whether any path component or intermediate ancestor traverses
 * a symlink that resolves outside the allowRoot perimeter.
 */
export function checkSymlinkEscape(targetPath, allowRoot) {
  const normTarget = resolvePath(targetPath);
  const normRoot = resolvePath(allowRoot);
  const canonicalRoot = canonicalizeWithAncestorRealpath(normRoot);

  let current = normTarget;

  while (current && current !== path.dirname(current)) {
    if (current === normRoot || current === canonicalRoot) {
      break;
    }

    if (fs.existsSync(current)) {
      try {
        const lstat = fs.lstatSync(current);
        if (lstat.isSymbolicLink()) {
          const real = fs.realpathSync(current);
          if (!isContainedWithin(real, normRoot) && !isContainedWithin(real, canonicalRoot)) {
            return true;
          }
        }
      } catch {}
    }

    current = path.dirname(current);
  }
  return false;
}

/**
 * Checks if targetPath is strictly equal to allowRoot or is a child of allowRoot
 * using directory boundary checking (e.g. /tmp/allowed vs /tmp/allowed-evil).
 */
export function isContainedWithin(targetPath, allowRoot) {
  const normTarget = resolvePath(targetPath);
  const normRoot = resolvePath(allowRoot);

  if (normTarget === normRoot) return true;
  const rootWithSep = normRoot.endsWith(path.sep) ? normRoot : normRoot + path.sep;
  if (normTarget.startsWith(rootWithSep)) return true;

  // Check canonical ancestor realpaths for symlinked system roots (e.g. macOS /var -> /private/var)
  try {
    const realTarget = canonicalizeWithAncestorRealpath(normTarget);
    const realRoot = canonicalizeWithAncestorRealpath(normRoot);
    if (realTarget === realRoot) return true;
    const realRootWithSep = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
    return realTarget.startsWith(realRootWithSep);
  } catch {
    return false;
  }
}

/**
 * 🛡️ Enforce Zero Trust RBAC Policy with Directory Boundary Containment
 */
export function enforceRbacPolicy(personaMeta, step) {
  if (!personaMeta || !personaMeta.rbac || !personaMeta.rbac.permissions) {
    return {
      allowed: false,
      role: 'unassigned',
      violation: `Missing mandatory Zero Trust RBAC contract for persona '${personaMeta?.name || 'unknown'}'`,
      code: 'RBAC_MANIFEST_MISSING'
    };
  }

  const { filesystem, mcp } = personaMeta.rbac.permissions;
  const role = personaMeta.rbac.role || personaMeta.name;

  const rawAction = String(step.action || '').trim().replace(/^["']|["']$/g, '');
  const rawTargets = [step.target, step.destination, step.scope]
    .filter(Boolean)
    .map(t => String(t).trim().replace(/^["']|["']$/g, ''));

  // AUD-001: Pre-resolve default targets if omitted by manifest step
  if (rawTargets.length === 0) {
    if (rawAction === 'contain_threat') {
      rawTargets.push(step.target || (process.env.DSH_WORKSPACE_ROOT ? path.join(process.env.DSH_WORKSPACE_ROOT, 'quarantine', 'quarantine_ledger.json') : '/workspaces/quarantine/quarantine_ledger.json'));
    } else if (rawAction === 'forensic_investigation') {
      rawTargets.push(step.scope || step.target || (process.env.DSH_WORKSPACE_ROOT ? path.join(process.env.DSH_WORKSPACE_ROOT, 'cases') : '/workspaces/cases'));
    } else if (rawAction === 'read_catalog') {
      rawTargets.push(step.scope || step.target || 'config/personas');
    } else if (rawAction === 'fetch_sources') {
      rawTargets.push(step.target || step.source || step.scope || (process.env.DSH_WORKSPACE_ROOT || '/workspaces'));
    }
  }

  // F-07: Resolve logical scopes ('recursive', 'workspace') into concrete targets before policy evaluation
  const targetsToCheck = rawTargets.map(t => {
    if (t === 'recursive' || t === 'workspace') {
      return step.concrete_target || process.env.DSH_WORKSPACE_ROOT || '/workspaces';
    }
    return t;
  });

  const isWriteAction = [
    'write_report', 'apply_fix_or_patch', 'save_artifact',
    'create_file', 'contain_threat', 'modify_file'
  ].includes(rawAction);

  const isReadAction = [
    'fetch_sources', 'inspect_sqlite', 'read_catalog',
    'forensic_investigation', 'inspect_tabular', 'read_file'
  ].includes(rawAction);

  // AUD-001: Fail-closed if a filesystem write or read action lacks a concrete target
  if (isWriteAction && targetsToCheck.length === 0) {
    return {
      allowed: false,
      role,
      violation: `Write action '${rawAction}' requires a concrete target, but none was provided or resolvable`,
      code: 'RBAC_TARGET_REQUIRED'
    };
  }

  if (isReadAction && targetsToCheck.length === 0) {
    return {
      allowed: false,
      role,
      violation: `Read action '${rawAction}' requires a concrete target, but none was provided or resolvable`,
      code: 'RBAC_TARGET_REQUIRED'
    };
  }

  for (const target of targetsToCheck) {
    let resolvedTarget = resolvePath(target);
    const canonicalTarget = canonicalizeWithAncestorRealpath(resolvedTarget);

    // 1. Strict Deny Rules Check (Explicit Disallow Trumps All)
    const deniedPatterns = filesystem?.deny || [];
    for (const pattern of deniedPatterns) {
      if (pattern.endsWith('*')) {
        const prefix = pattern.slice(0, -1);
        const normPrefix = path.resolve(prefix);
        if (
          isContainedWithin(resolvedTarget, prefix) ||
          isContainedWithin(canonicalTarget, prefix) ||
          isContainedWithin(resolvedTarget, normPrefix) ||
          isContainedWithin(target, prefix) ||
          target.startsWith(prefix)
        ) {
          return {
            allowed: false,
            role,
            violation: `Target '${target}' matches denied prefix '${pattern}'`,
            code: 'RBAC_DENY_VIOLATION'
          };
        }
      } else {
        const normPattern = path.resolve(pattern);
        let realPattern = normPattern;
        if (fs.existsSync(normPattern)) {
          try { realPattern = fs.realpathSync(normPattern); } catch {}
        }
        if (
          resolvedTarget === pattern ||
          resolvedTarget === normPattern ||
          resolvedTarget === realPattern ||
          canonicalTarget === pattern ||
          canonicalTarget === normPattern ||
          canonicalTarget === realPattern ||
          target === pattern ||
          isContainedWithin(resolvedTarget, pattern) ||
          isContainedWithin(canonicalTarget, pattern) ||
          isContainedWithin(resolvedTarget, realPattern) ||
          isContainedWithin(canonicalTarget, realPattern) ||
          isContainedWithin(target, pattern)
        ) {
          return {
            allowed: false,
            role,
            violation: `Target '${target}' explicitly denied by RBAC policy rule '${pattern}'`,
            code: 'RBAC_DENY_VIOLATION'
          };
        }
      }
    }

    // 2. Strict Write Allowlist Check (Must be contained within filesystem.write)
    if (isWriteAction) {
      const allowedWrites = Array.isArray(filesystem?.write) ? filesystem.write : [];

      for (const allowedRoot of allowedWrites) {
        if (isContainedWithin(resolvedTarget, allowedRoot) && checkSymlinkEscape(resolvedTarget, allowedRoot)) {
          return {
            allowed: false,
            role,
            violation: `Target '${target}' traverses symlink escaping allowed root '${allowedRoot}'`,
            code: 'RBAC_SYMLINK_ESCAPE'
          };
        }
      }

      const permitted = allowedWrites.some(allowedRoot =>
        isContainedWithin(resolvedTarget, allowedRoot) &&
        isContainedWithin(canonicalTarget, allowedRoot)
      );
      if (!permitted) {
        return {
          allowed: false,
          role,
          violation: `Write target '${target}' not permitted by filesystem.write allowlist`,
          code: 'RBAC_WRITE_UNAUTHORIZED'
        };
      }
    }

    // 3. Strict Read Allowlist Check (Must be contained within filesystem.read)
    if (isReadAction) {
      const allowedReads = Array.isArray(filesystem?.read) ? filesystem.read : [];

      for (const allowedRoot of allowedReads) {
        if (isContainedWithin(resolvedTarget, allowedRoot) && checkSymlinkEscape(resolvedTarget, allowedRoot)) {
          return {
            allowed: false,
            role,
            violation: `Target '${target}' traverses symlink escaping allowed root '${allowedRoot}'`,
            code: 'RBAC_SYMLINK_ESCAPE'
          };
        }
      }

      const permitted = allowedReads.some(allowedRoot =>
        isContainedWithin(resolvedTarget, allowedRoot) &&
        isContainedWithin(canonicalTarget, allowedRoot)
      );
      if (!permitted) {
        return {
          allowed: false,
          role,
          violation: `Read target '${target}' not permitted by filesystem.read allowlist`,
          code: 'RBAC_READ_UNAUTHORIZED'
        };
      }
    }
  }

  // 4. MCP Server Authorization Check
  if (step.action && step.action.startsWith('mcp:')) {
    const requestedMcp = step.action.replace(/^mcp:/, '');
    const allowedMcps = mcp?.allowed || [];
    if (!allowedMcps.includes(requestedMcp)) {
      return {
        allowed: false,
        role,
        violation: `MCP tool '${requestedMcp}' not permitted for role '${role}'`,
        code: 'RBAC_MCP_UNAUTHORIZED'
      };
    }
  }

  return { allowed: true, role, reason: 'RBAC policy validated' };
}

export function getGrcAuditLogPath() {
  if (process.env.DSH_AUDIT_LOG_FILE) return process.env.DSH_AUDIT_LOG_FILE;
  if (fs.existsSync('/var/log/dsh')) return '/var/log/dsh/audit_grc.jsonl';
  const runtimeDir = process.env.DSH_RUNTIME_DIR || path.join(process.cwd(), 'config');
  return path.join(runtimeDir, 'audit', 'audit_grc.jsonl');
}

export async function emitGrcSpanToPhoenix(event) {
  const phoenixUrl = process.env.PHOENIX_URL || 'http://phoenix:6006';
  const apiKey = process.env.PHOENIX_API_KEY || '';
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
    headers['api_key'] = apiKey;
  }

  const nowMs = Date.now();
  const spanPayload = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'dsh-grc-firewall' } },
            { key: 'persona', value: { stringValue: event.persona || 'unknown' } },
            { key: 'role', value: { stringValue: event.role || 'default' } }
          ]
        },
        scopeSpans: [
          {
            scope: { name: 'grc.authorization.policy' },
            spans: [
              {
                traceId: (event.trace_id || nowMs.toString(16)).padStart(32, '0').slice(0, 32),
                spanId: Math.floor(Math.random() * 0xFFFFFFFF).toString(16).padStart(16, '0'),
                name: `grc.policy.${(event.decision || 'unknown').toLowerCase()}`,
                kind: 1,
                startTimeUnixNano: (nowMs * 1000000).toString(),
                endTimeUnixNano: ((nowMs + 1) * 1000000).toString(),
                attributes: [
                  { key: 'grc.decision', value: { stringValue: String(event.decision || '') } },
                  { key: 'grc.action', value: { stringValue: String(event.action || 'unknown') } },
                  { key: 'grc.target', value: { stringValue: String(event.target || '') } },
                  { key: 'grc.reason', value: { stringValue: String(event.reason || '') } }
                ],
                status: {
                  code: event.decision === 'GRANTED' ? 1 : 2
                }
              }
            ]
          }
        ]
      }
    ]
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    await fetch(`${phoenixUrl}/v1/traces`, {
      method: 'POST',
      headers,
      body: JSON.stringify(spanPayload),
      signal: controller.signal
    });
    clearTimeout(timeout);
  } catch {
    // Non-blocking out-of-band telemetry
  }
}

export function logGrcAuditEvent(event, traceId = null) {
  const auditEntry = {
    timestamp: new Date().toISOString(),
    event_type: 'GRC_AUTHORIZATION_DECISION',
    trace_id: traceId || event.trace_id || null,
    ...event
  };

  const primaryFile = getGrcAuditLogPath();

  try {
    const dir = path.dirname(primaryFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.appendFileSync(primaryFile, JSON.stringify(auditEntry) + '\n', { encoding: 'utf8', mode: 0o600 });
  } catch {
    try {
      const fallbackDir = process.env.DSH_SESSIONS_DIR || path.join(process.cwd(), 'config', 'sessions');
      const fallbackFile = path.join(fallbackDir, 'audit_grc.jsonl');
      fs.appendFileSync(fallbackFile, JSON.stringify(auditEntry) + '\n', 'utf8');
    } catch {}
  }

  // Non-blocking asynchronous OTel trace dispatch
  emitGrcSpanToPhoenix(auditEntry).catch(() => {});

  return auditEntry;
}
