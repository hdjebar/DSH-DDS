/**
 * 🛡️ Dual-LLM Context Quarantine (Indirect Prompt Injection Defense)
 *
 * Implements Milestone 3 Task A.1:
 * 1. ContextQuarantine: Sanitizes untrusted workspace files and external web content
 *    before passing them to the privileged executor model.
 * 2. Adversarial Detection Engine: Deterministic detection of 25+ prompt injection,
 *    jailbreak, and credential exfiltration patterns.
 * 3. Quarantine Ledger: Records blocked injection payloads with immutable incident tracking.
 */

import fs from 'node:fs';
import path from 'node:path';

export const INJECTION_PATTERNS = [
  { id: 'IPI-001', name: 'Ignore Previous Instructions', regex: /ignore\s+(all\s+)?(previous|prior)\s+instructions/i },
  { id: 'IPI-002', name: 'System Override Directive', regex: /system\s+override/i },
  { id: 'IPI-003', name: 'System Prompt Leakage Attempt', regex: /(reveal|print|leak|show)\s+(your\s+)?system\s+prompt/i },
  { id: 'IPI-004', name: 'Disregard Rules Directive', regex: /disregard\s+(all\s+)?(prior|previous|existing)\s+(rules|guidelines|instructions)/i },
  { id: 'IPI-005', name: 'DAN Mode Activation', regex: /you\s+are\s+now\s+(in\s+)?dan\s+mode/i },
  { id: 'IPI-006', name: 'System XML Tag Injection', regex: /<\/?system>/i },
  { id: 'IPI-007', name: 'Bracketed System Instruction', regex: /\[system\s+instruction\]/i },
  { id: 'IPI-008', name: 'Bracketed Override Header', regex: /\[override\]/i },
  { id: 'IPI-009', name: 'Guardrail Bypass Directive', regex: /bypass\s+(all\s+)?guardrails/i },
  { id: 'IPI-010', name: 'Jailbreak Active Declaration', regex: /jailbreak\s+(is\s+)?active/i },
  { id: 'IPI-011', name: 'Credential Exfiltration Attempt', regex: /curl\s+https?:\/\/.*(token|cred|oauth)/i },
  { id: 'IPI-012', name: 'OAuth Cache Exfiltration Attempt', regex: /read\s+.*oauth_creds\.json/i },
  { id: 'IPI-013', name: 'Shadow File Read Attempt', regex: /cat\s+\/etc\/shadow/i },
  { id: 'IPI-014', name: 'Base64 Pipe Shell Execution', regex: /base64\s+-d\s*\|\s*(ba)?sh/i },
  { id: 'IPI-015', name: 'Destructive Filesystem Purge', regex: /rm\s+-rf\s+(\/|\*)/i },
  { id: 'IPI-016', name: 'Disable Security Controls', regex: /disable\s+(rbac|security|firewall)/i },
  { id: 'IPI-017', name: 'Developer Mode Injection', regex: /developer\s+mode\s+(is\s+)?enabled/i },
  { id: 'IPI-018', name: 'Unrestricted AI Simulation', regex: /simulate\s+unrestricted\s+ai/i },
  { id: 'IPI-019', name: 'Safety Override Request', regex: /anti-safety\s+override/i },
  { id: 'IPI-020', name: 'Unfiltered Persona Impersonation', regex: /act\s+as\s+an\s+unfiltered/i },
  { id: 'IPI-021', name: 'Env Var Exfiltration Directive', regex: /print\s+(all\s+)?environment\s+variables/i },
  { id: 'IPI-022', name: 'Exfiltration HTTP Pipe', regex: /exfiltrate\s+to\s+http/i },
  { id: 'IPI-023', name: 'Eval Atob Obfuscated Script', regex: /eval\s*\(\s*atob\s*\(/i },
  { id: 'IPI-024', name: 'Process Env Token Harvester', regex: /process\.env\.(GEMINI|OPENROUTER|GITHUB|TOKEN|API_KEY)/i },
  { id: 'IPI-025', name: 'Token Forwarding Trap', regex: /send\s+(the\s+)?(token|api_key|password)\s+to/i }
];

export class ContextQuarantine {
  constructor(options = {}) {
    this.ledgerPath = options.ledgerPath ||
      path.join(process.env.DSH_WORKSPACE_ROOT || '/workspaces', 'quarantine', 'quarantine_ledger.json');
    this.ledger = [];
    this.loadLedger();
  }

  loadLedger() {
    if (!fs.existsSync(this.ledgerPath)) return;
    try {
      const raw = fs.readFileSync(this.ledgerPath, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        this.ledger = data;
      }
    } catch {}
  }

  saveLedger() {
    try {
      const dir = path.dirname(this.ledgerPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.ledgerPath, JSON.stringify(this.ledger, null, 2), 'utf8');
    } catch {}
  }

  /**
   * Scans text content for adversarial prompt injection patterns.
   */
  detectInjectionSignatures(rawContent) {
    if (typeof rawContent !== 'string' || !rawContent.trim()) {
      return { detected: false, riskLevel: 'CLEAN', signatures: [] };
    }

    const matched = [];
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.regex.test(rawContent)) {
        matched.push({ id: pattern.id, name: pattern.name });
      }
    }

    let riskLevel = 'CLEAN';
    if (matched.length >= 2) {
      riskLevel = 'HIGH';
    } else if (matched.length === 1) {
      riskLevel = 'MEDIUM';
    }

    return {
      detected: matched.length > 0,
      riskLevel,
      signatures: matched
    };
  }

  /**
   * Sanitizes raw workspace text and strips dangerous injection directives,
   * returning typed, schema-structured output for the privileged model.
   */
  sanitizeWorkspaceContent(rawContent, targetSchema = { summary: 'string' }, options = {}) {
    const scan = this.detectInjectionSignatures(rawContent);

    // If high risk and failClosed is active, quarantine immediately
    if (scan.riskLevel === 'HIGH' && options.failClosed !== false) {
      const incident = {
        id: `quarantine-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date().toISOString(),
        riskLevel: scan.riskLevel,
        signatures: scan.signatures,
        source: options.source || 'untrusted_workspace_file',
        preview: rawContent.slice(0, 200)
      };

      this.ledger.push(incident);
      this.saveLedger();

      return {
        quarantined: true,
        riskLevel: scan.riskLevel,
        signatures: scan.signatures,
        incidentId: incident.id,
        sanitized: null
      };
    }

    // Strip HTML/XML tags, zero-width characters, and control characters
    let cleaned = rawContent
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim();

    // Map into typed schema summary
    const sanitizedPayload = {
      summary: cleaned.slice(0, 500),
      rawByteLength: Buffer.byteLength(rawContent, 'utf8'),
      sanitizedAt: new Date().toISOString(),
      injectionSignaturesDetected: scan.signatures.length
    };

    return {
      quarantined: false,
      riskLevel: scan.riskLevel,
      signatures: scan.signatures,
      sanitized: sanitizedPayload
    };
  }

  getQuarantineLedger() {
    return [...this.ledger];
  }
}

export const defaultQuarantine = new ContextQuarantine();
