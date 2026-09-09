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
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function getYamlEngine() {
  try {
    return require('yaml');
  } catch {
    try {
      return require('/usr/local/lib/node_modules/yaml');
    } catch {
      throw new Error('YAML_ENGINE_MISSING: npm package "yaml" is required but not installed');
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
  if (!candidatePath || typeof candidatePath !== 'string') {
    throw new Error(`resolvePath: expected non-empty scalar string path, received ${Array.isArray(candidatePath) ? 'array' : typeof candidatePath}`);
  }
  const clean = candidatePath.trim().replace(/^["']|["']$/g, '');
  if (!clean) {
    throw new Error('resolvePath: received empty string path');
  }

  // If a test/isolated workspace root is provided, always map /workspaces into it
  if (process.env.DSH_WORKSPACE_ROOT && (clean === '/workspaces' || clean.startsWith('/workspaces/'))) {
    const rel = clean === '/workspaces' ? '' : clean.slice('/workspaces/'.length);
    return path.resolve(process.env.DSH_WORKSPACE_ROOT, rel);
  }

  if (process.env.DSH_RUNTIME_DIR && (clean === '/root/.dsh' || clean.startsWith('/root/.dsh/'))) {
    const rel = clean === '/root/.dsh' ? '' : clean.slice('/root/.dsh/'.length);
    return path.resolve(process.env.DSH_RUNTIME_DIR, rel);
  }

  if (process.env.DSH_RUNTIME_DIR && (clean === '/var/lib/dsh' || clean.startsWith('/var/lib/dsh/'))) {
    const rel = clean === '/var/lib/dsh' ? '' : clean.slice('/var/lib/dsh/'.length);
    return path.resolve(process.env.DSH_RUNTIME_DIR, rel);
  }

  if (fs.existsSync('/workspaces') || fs.existsSync('/var/lib/dsh') || fs.existsSync('/root/.dsh')) {
    return path.resolve(clean);
  }

  if (clean === '/workspaces' || clean.startsWith('/workspaces/')) {
    const rel = clean === '/workspaces' ? '' : clean.slice('/workspaces/'.length);
    return path.resolve(process.cwd(), 'workspaces', rel);
  }

  if (clean === '/root/.dsh' || clean.startsWith('/root/.dsh/')) {
    const rel = clean === '/root/.dsh' ? '' : clean.slice('/root/.dsh/'.length);
    return path.resolve(process.cwd(), 'config', rel);
  }

  if (clean === '/var/lib/dsh' || clean.startsWith('/var/lib/dsh/')) {
    const rel = clean === '/var/lib/dsh' ? '' : clean.slice('/var/lib/dsh/'.length);
    return path.resolve(process.cwd(), 'config', rel);
  }

  if (clean === '/etc/dsh' || clean.startsWith('/etc/dsh/')) {
    const rel = clean === '/etc/dsh' ? '' : clean.slice('/etc/dsh/'.length);
    return path.resolve(process.cwd(), 'config', rel);
  }

  return path.resolve(clean);
}

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

  if (!step || typeof step !== 'object') {
    return {
      allowed: false,
      role,
      violation: 'Invalid step descriptor: expected object',
      code: 'RBAC_TARGET_INVALID'
    };
  }

  // PR-002: Strict validation of resource scalar types
  const resourceFields = ['target', 'destination', 'scope', 'source', 'concrete_target', 'schema', 'path', 'file', 'workdir', 'cwd', 'command'];
  for (const field of resourceFields) {
    if (field in step && step[field] !== undefined && step[field] !== null) {
      const val = step[field];
      if (typeof val !== 'string') {
        return {
          allowed: false,
          role,
          violation: `Invalid resource type for '${field}': expected non-empty scalar string, received ${Array.isArray(val) ? 'array' : typeof val}`,
          code: 'RBAC_TARGET_INVALID'
        };
      }
      if (val.trim().length === 0) {
        return {
          allowed: false,
          role,
          violation: `Invalid resource value for '${field}': cannot be empty or whitespace only`,
          code: 'RBAC_TARGET_INVALID'
        };
      }
    }
  }

  if (typeof step.action !== 'string' || step.action.trim().length === 0) {
    return {
      allowed: false,
      role,
      violation: 'Workflow step missing valid string action',
      code: 'RBAC_ACTION_INVALID'
    };
  }

  const rawAction = step.action.trim().replace(/^["']|["']$/g, '');
  const rawTargets = [step.target, step.destination, step.scope, step.schema, step.path, step.file]
    .filter(Boolean)
    .map(t => t.trim().replace(/^["']|["']$/g, ''));

  // AUD-001: Pre-resolve default targets if omitted by manifest step
  if (rawTargets.length === 0) {
    if (rawAction === 'contain_threat') {
      rawTargets.push(step.target || (process.env.DSH_WORKSPACE_ROOT ? path.join(process.env.DSH_WORKSPACE_ROOT, 'quarantine', 'quarantine_ledger.json') : '/workspaces/quarantine/quarantine_ledger.json'));
    } else if (rawAction === 'escalate_to_soc') {
      rawTargets.push(step.target || (process.env.DSH_WORKSPACE_ROOT ? path.join(process.env.DSH_WORKSPACE_ROOT, 'cases', 'soc_escalation.json') : '/workspaces/cases/soc_escalation.json'));
    } else if (rawAction === 'forensic_investigation') {
      rawTargets.push(step.scope || step.target || (process.env.DSH_WORKSPACE_ROOT ? path.join(process.env.DSH_WORKSPACE_ROOT, 'cases') : '/workspaces/cases'));
    } else if (rawAction === 'read_catalog') {
      rawTargets.push(step.scope || step.target || 'config/personas');
    } else if (rawAction === 'fetch_sources') {
      rawTargets.push(step.target || step.source || step.scope || (process.env.DSH_WORKSPACE_ROOT || '/workspaces'));
    } else if (rawAction === 'run_shell') {
      rawTargets.push(step.target || step.workdir || step.cwd || (process.env.DSH_WORKSPACE_ROOT ? path.join(process.env.DSH_WORKSPACE_ROOT, 'cases') : '/workspaces/cases'));
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
    'create_file', 'contain_threat', 'modify_file', 'escalate_to_soc',
    'run_shell'
  ].includes(rawAction);

  const isReadAction = [
    'fetch_sources', 'inspect_sqlite', 'read_catalog',
    'forensic_investigation', 'inspect_tabular', 'read_file',
    'validate_sdmx_schema'
  ].includes(rawAction);

  const isComputeAction = [
    'run_llm_query', 'parse_intent', 'evaluate_incident',
    'probe_services', 'verify_endpoint', 'fetch_sdmx_dataflows'
  ].includes(rawAction);

  // Emergency containment: directory checks cannot confine a general-purpose shell.
  // Keep shell disabled unless the host operator explicitly accepts the risk for a
  // trusted, single-operator deployment. The escape hatch is never honored by the
  // untrusted sandbox profile.
  if (
    rawAction === 'run_shell'
    && process.env.DSH_EXECUTOR_MODE !== 'isolated'
    && (process.env.DSH_ALLOW_UNCONFINED_SHELL !== '1' || process.env.DSH_SANDBOX === '1')
  ) {
    return {
      allowed: false,
      role,
      violation: 'Unconfined shell execution is disabled; use an isolated executor',
      code: 'RBAC_SHELL_ISOLATION_REQUIRED'
    };
  }

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

  // Command string check against denied patterns.
  // NOTE: this is a substring tripwire, not containment. A shell command can trivially
  // evade it (quoting, $IFS, variable expansion, base64, symlinks), so it must never be
  // treated as the control that confines `run_shell`. In isolated mode confinement comes
  // from a PEP-issued, workdir-bound capability plus the executor's Landlock rules and
  // network/mount namespace. It stays because a cheap tripwire that fires loudly is useful.
  if (step.command && typeof step.command === 'string') {
    const deniedPatterns = filesystem?.deny || [];
    for (const pattern of deniedPatterns) {
      if (!pattern) continue;
      const cleanPattern = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
      if (cleanPattern && (step.command === cleanPattern || step.command.includes(cleanPattern))) {
        return {
          allowed: false,
          role,
          violation: `Command '${step.command}' contains denied token '${pattern}'`,
          code: 'RBAC_SUSPICIOUS_COMMAND'
        };
      }
    }
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

  // 5. Strict Fail-Closed on Unrecognized Action (AUD Finding 1)
  if (!isWriteAction && !isReadAction && !isComputeAction && !rawAction.startsWith('mcp:')) {
    return {
      allowed: false,
      role,
      violation: `Action '${rawAction}' is not categorized as read, write, compute, or mcp. Fail-closed policy rejected execution.`,
      code: 'RBAC_ACTION_UNRECOGNIZED'
    };
  }

  return {
    allowed: true,
    role,
    reason: 'RBAC policy validated',
    targets: targetsToCheck,
    resolvedTarget: targetsToCheck[0] ? resolvePath(targetsToCheck[0]) : null
  };
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

/**
 * Best-effort variant of logGrcAuditEvent for call sites whose outcome is ALREADY a
 * refusal, suspension, or recovery (DENIED / GATED / LOOP_DETECTED).
 *
 * logGrcAuditEvent is deliberately fail-closed so a GRANT cannot execute unrecorded.
 * Applying that to a path that already refuses is counterproductive: the audit error
 * would replace the policy violation the caller needs to see, and would turn a
 * resumable approval gate or a recoverable loop trap into a hard failure. Here the
 * original outcome wins, but the write failure is still reported loudly on stderr so
 * it cannot pass unnoticed.
 */
export function logGrcAuditEventBestEffort(event, traceId = null) {
  try {
    return logGrcAuditEvent(event, traceId);
  } catch (err) {
    console.error(`\u26a0\ufe0f  GRC_AUDIT_WRITE_FAILED (non-blocking, decision was '${event?.decision || 'unknown'}'): ${err.message}`);
    return null;
  }
}

function auditDigest(entry, integrityKey = '') {
  const serialized = JSON.stringify(entry);
  return integrityKey
    ? crypto.createHmac('sha256', integrityKey).update(serialized).digest('hex')
    : crypto.createHash('sha256').update(serialized).digest('hex');
}

const auditChainHeadCache = new Map();
const auditLockWaitBuffer = new Int32Array(new SharedArrayBuffer(4));

function withAuditFileLock(filePath, operation) {
  const lockPath = `${filePath}.lock`;
  const deadline = Date.now() + 5000;
  let fd;
  while (fd === undefined) {
    try {
      fd = fs.openSync(lockPath, 'wx', 0o600);
      fs.writeFileSync(fd, `${process.pid}\n${Date.now()}\n`);
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > 30000) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch (statError) {
        if (statError?.code === 'ENOENT') continue;
        throw statError;
      }
      if (Date.now() >= deadline) {
        throw new Error(`GRC_AUDIT_WRITE_FAILED: timed out acquiring '${lockPath}'`);
      }
      Atomics.wait(auditLockWaitBuffer, 0, 0, 10);
    }
  }

  try {
    return operation();
  } finally {
    try { fs.closeSync(fd); } catch {}
    try { fs.unlinkSync(lockPath); } catch {}
  }
}

function readAuditChainHead(filePath, integrityKey = '') {
  if (!fs.existsSync(filePath)) {
    auditChainHeadCache.delete(filePath);
    return { sequence: 0, hash: null };
  }
  const stat = fs.statSync(filePath);
  const keyId = crypto.createHash('sha256').update(integrityKey).digest('hex');
  const cached = auditChainHeadCache.get(filePath);
  if (
    cached
    && cached.size === stat.size
    && cached.mtimeMs === stat.mtimeMs
    && cached.ctimeMs === stat.ctimeMs
    && cached.keyId === keyId
  ) {
    return { sequence: cached.sequence, hash: cached.hash };
  }
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  if (lines.length === 0) return { sequence: 0, hash: null };

  const raw = lines.at(-1);
  let last;
  try {
    last = JSON.parse(raw);
  } catch {
    throw new Error(`GRC_AUDIT_INTEGRITY_FAILED: '${filePath}' ends with malformed JSON`);
  }

  if (!last.entry_hash) {
    // Migration anchor for logs written before hash chaining was introduced.
    const head = {
      sequence: 0,
      hash: crypto.createHash('sha256').update(raw).digest('hex')
    };
    auditChainHeadCache.set(filePath, { ...head, keyId, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs });
    return head;
  }

  const verification = verifyGrcAuditChain(filePath, integrityKey);
  if (!verification.valid) {
    throw new Error(
      `GRC_AUDIT_INTEGRITY_FAILED: audit chain in '${filePath}' is invalid (${verification.reason})`
    );
  }

  const { entry_hash: storedHash, ...unsigned } = last;
  if (!['sha256', 'hmac-sha256'].includes(last.integrity_algorithm)) {
    throw new Error('GRC_AUDIT_INTEGRITY_FAILED: unsupported audit integrity algorithm');
  }
  if (integrityKey && last.integrity_algorithm !== 'hmac-sha256') {
    throw new Error('GRC_AUDIT_INTEGRITY_FAILED: keyed audit chain was downgraded');
  }
  if (last.integrity_algorithm === 'hmac-sha256' && !integrityKey) {
    throw new Error('GRC_AUDIT_INTEGRITY_FAILED: DSH_AUDIT_INTEGRITY_KEY is required to continue this audit chain');
  }
  const expectedHash = auditDigest(unsigned, last.integrity_algorithm === 'hmac-sha256' ? integrityKey : '');
  if (storedHash !== expectedHash) {
    throw new Error(`GRC_AUDIT_INTEGRITY_FAILED: audit chain head in '${filePath}' was modified`);
  }
  const head = { sequence: Number(last.sequence) || 0, hash: storedHash };
  auditChainHeadCache.set(filePath, { ...head, keyId, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs });
  return head;
}

function appendChainedAuditEntry(filePath, baseEntry, integrityKey = '') {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return withAuditFileLock(filePath, () => {
    const head = readAuditChainHead(filePath, integrityKey);
    const unsigned = {
      ...baseEntry,
      sequence: head.sequence + 1,
      previous_hash: head.hash,
      integrity_algorithm: integrityKey ? 'hmac-sha256' : 'sha256'
    };
    const auditEntry = { ...unsigned, entry_hash: auditDigest(unsigned, integrityKey) };
    fs.appendFileSync(filePath, JSON.stringify(auditEntry) + '\n', { encoding: 'utf8', mode: 0o600 });
    const stat = fs.statSync(filePath);
    auditChainHeadCache.set(filePath, {
      sequence: auditEntry.sequence,
      hash: auditEntry.entry_hash,
      keyId: crypto.createHash('sha256').update(integrityKey).digest('hex'),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs
    });
    return auditEntry;
  });
}

export function verifyGrcAuditChain(filePath, integrityKey = process.env.DSH_AUDIT_INTEGRITY_KEY || '') {
  if (!fs.existsSync(filePath)) return { valid: true, entries: 0, protectedEntries: 0 };
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  let previousHash = null;
  let expectedSequence = 1;
  let protectedEntries = 0;

  for (const raw of lines) {
    let entry;
    try { entry = JSON.parse(raw); } catch { return { valid: false, reason: 'malformed JSON' }; }
    if (!entry.entry_hash) {
      if (protectedEntries > 0) return { valid: false, reason: 'legacy entry appears after protected chain' };
      previousHash = crypto.createHash('sha256').update(raw).digest('hex');
      continue;
    }
    if (entry.sequence !== expectedSequence) return { valid: false, reason: 'sequence mismatch' };
    if (entry.previous_hash !== previousHash) return { valid: false, reason: 'previous hash mismatch' };
    if (!['sha256', 'hmac-sha256'].includes(entry.integrity_algorithm)) {
      return { valid: false, reason: 'unsupported integrity algorithm' };
    }
    if (integrityKey && entry.integrity_algorithm !== 'hmac-sha256') {
      return { valid: false, reason: 'integrity algorithm downgrade' };
    }
    if (entry.integrity_algorithm === 'hmac-sha256' && !integrityKey) {
      return { valid: false, reason: 'integrity key required' };
    }
    const { entry_hash: storedHash, ...unsigned } = entry;
    const expectedHash = auditDigest(unsigned, entry.integrity_algorithm === 'hmac-sha256' ? integrityKey : '');
    if (storedHash !== expectedHash) return { valid: false, reason: 'entry hash mismatch' };
    previousHash = storedHash;
    expectedSequence += 1;
    protectedEntries += 1;
  }
  return { valid: true, entries: lines.length, protectedEntries };
}

export function logGrcAuditEvent(event, traceId = null) {
  const baseEntry = {
    timestamp: new Date().toISOString(),
    event_type: 'GRC_AUTHORIZATION_DECISION',
    trace_id: traceId || event.trace_id || null,
    ...event
  };

  // Production deployments send authorization evidence to a separate writer that
  // exclusively owns both the ledger and its HMAC key. Keep this call synchronous:
  // callers rely on a successful append before a GRANTED operation may execute.
  if (process.env.DSH_AUDIT_WRITER_URL) {
    const clientPath = fileURLToPath(new URL('./audit-client.mjs', import.meta.url));
    const remoteEvent = { ...event, trace_id: traceId || event.trace_id || null };
    let serialized;
    try {
      serialized = execFileSync(process.execPath, [clientPath], {
        input: JSON.stringify(remoteEvent),
        encoding: 'utf8',
        timeout: 5000,
        maxBuffer: 256 * 1024,
        env: {
          PATH: process.env.PATH || '/usr/bin:/bin',
          HOME: process.env.HOME || '/tmp',
          DSH_AUDIT_WRITER_URL: process.env.DSH_AUDIT_WRITER_URL,
          DSH_AUDIT_WRITER_TOKEN: process.env.DSH_AUDIT_WRITER_TOKEN || ''
        },
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch {
      throw new Error('GRC_AUDIT_WRITE_FAILED: external audit writer unavailable or refused the event');
    }
    let auditEntry;
    try { auditEntry = JSON.parse(serialized); }
    catch { throw new Error('GRC_AUDIT_WRITE_FAILED: external audit writer returned an invalid receipt'); }
    emitGrcSpanToPhoenix(auditEntry).catch(() => {});
    return auditEntry;
  }

  if (process.env.DSH_AUDIT_WRITER_REQUIRED === '1') {
    throw new Error('GRC_AUDIT_WRITE_FAILED: external audit writer is required but not configured');
  }

  const primaryFile = getGrcAuditLogPath();
  const integrityKey = process.env.DSH_AUDIT_INTEGRITY_KEY || '';

  // Fail-closed: an authorization decision that cannot be recorded must not execute.
  // The primary sink is tried first, then a fallback; if BOTH fail the error propagates
  // to the caller so the intercepted action is refused rather than silently unlogged.
  let primaryError;
  let auditEntry;
  try {
    auditEntry = appendChainedAuditEntry(primaryFile, baseEntry, integrityKey);
  } catch (err) {
    primaryError = err;
    // A fallback sink is appropriate for I/O failure, but not for evidence that the
    // configured primary trail was modified. Continuing on a fresh file would hide
    // the break and allow a grant after audit tampering.
    if (String(err?.message || '').startsWith('GRC_AUDIT_INTEGRITY_FAILED')) throw err;
    try {
      const fallbackDir = process.env.DSH_SESSIONS_DIR || path.join(process.cwd(), 'config', 'sessions');
      const fallbackFile = path.join(fallbackDir, 'audit_grc.jsonl');
      auditEntry = appendChainedAuditEntry(fallbackFile, baseEntry, integrityKey);
    } catch (fallbackErr) {
      throw new Error(
        `GRC_AUDIT_WRITE_FAILED: could not record authorization decision to '${primaryFile}' `
        + `(${primaryError.message}) or to the fallback sink (${fallbackErr.message}).`
      );
    }
  }

  // Non-blocking asynchronous OTel trace dispatch
  emitGrcSpanToPhoenix(auditEntry).catch(() => {});

  return auditEntry;
}
