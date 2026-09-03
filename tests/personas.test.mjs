import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const PERSONAS_DIR = path.join(ROOT, 'config', 'personas');
const TEMPLATES_DIR = path.join(ROOT, 'config', 'templates', 'personas');

test('Security Sandbox Invariant: no executable scripts exist in persona packages', () => {
  const checkDirForExecutables = (dir) => {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        checkDirForExecutables(fullPath);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        assert.ok(
          !['.sh', '.bash', '.zsh', '.exe', '.bin'].includes(ext),
          `Security violation: executable script '${entry.name}' found at '${fullPath}'. Workflows must be 100% declarative in persona.yaml.`
        );
      }
    }
  };

  checkDirForExecutables(PERSONAS_DIR);
  checkDirForExecutables(TEMPLATES_DIR);
});

test('Persona Architecture: all 7 domain personas have valid declarative manifests', () => {
  const expectedPersonas = [
    'data-analyst',
    'devops-sre',
    'mlops-engineer',
    'persona-creator',
    'sdmx-expert',
    'security-auditor',
    'stats-engineer'
  ];

  for (const name of expectedPersonas) {
    const personaDir = path.join(PERSONAS_DIR, name);
    assert.ok(fs.existsSync(personaDir), `Persona directory must exist: ${name}`);

    const manifestPath = path.join(personaDir, 'persona.yaml');
    assert.ok(fs.existsSync(manifestPath), `persona.yaml must exist for: ${name}`);

    const content = fs.readFileSync(manifestPath, 'utf8');
    assert.match(content, new RegExp(`name:\\s*${name}`), `Manifest name must match directory for ${name}`);
    assert.match(content, /models:\s*\n/, `Manifest must define models matrix for ${name}`);
    assert.match(content, /workflows:\s*\n/, `Manifest must define declarative workflows for ${name}`);

    const skillPath = path.join(personaDir, 'SKILL.md');
    assert.ok(fs.existsSync(skillPath), `Local SKILL.md must exist for: ${name}`);

    const activeSkillPath = path.join(ROOT, 'config', 'skills', name, 'SKILL.md');
    assert.ok(fs.existsSync(activeSkillPath), `Active skill in config/skills/${name}/SKILL.md must exist`);
  }
});

import { validateSlug, validateSessionId } from '../config/persona.mjs';

test('Persona Workflows: security-auditor has 100% declarative step-based workflow pipeline', () => {
  const manifestPath = path.join(PERSONAS_DIR, 'security-auditor', 'persona.yaml');
  const content = fs.readFileSync(manifestPath, 'utf8');

  assert.ok(content.includes('audit_code:'), 'security-auditor must contain declarative audit_code workflow');
  assert.ok(content.includes('steps:'), 'audit_code workflow must define structured steps');
  assert.ok(content.includes('action: "fetch_sources"'), 'Step 1 must be fetch_sources');
  assert.ok(content.includes('action: "run_llm_query"'), 'Step 2 must be run_llm_query');
  assert.ok(content.includes('action: "apply_fix_or_patch"'), 'Step 3 must be apply_fix_or_patch');
  assert.ok(content.includes('action: "write_report"'), 'Step 4 must be write_report');
});

test('Adaptive Case Management: security-auditor supports conditional branching and approval gates', () => {
  const manifestPath = path.join(PERSONAS_DIR, 'security-auditor', 'persona.yaml');
  const content = fs.readFileSync(manifestPath, 'utf8');

  assert.ok(content.includes('incident_triage:'), 'security-auditor must contain incident_triage case management workflow');
  assert.ok(content.includes('type: case-management'), 'incident_triage must declare type: case-management');
  assert.ok(content.includes('output_variable: "incident_severity"'), 'Step 1 must output state variable');
  assert.ok(content.includes("when: \"incident_severity == 'CRITICAL'\""), 'Step 2 must declare conditional branch');
  assert.ok(content.includes('approval_required: true'), 'Step 2 must declare human-in-the-loop approval gate');
  assert.ok(content.includes('on_failure: "escalate_to_soc"'), 'Step 2 must declare on_failure fallback');
});

test('Transactional Firewall: blocks prompt injection path traversal and unauthorized system targets', () => {
  const maliciousSlugs = [
    '../../etc/shadow',
    'audit; rm -rf /',
    'persona`curl evil.com`',
    'persona|bash',
    '../config/personas',
    '../../../../root/.ssh/id_rsa'
  ];

  for (const malicious of maliciousSlugs) {
    assert.throws(
      () => validateSlug(malicious, 'persona name'),
      /Invalid persona name/,
      `Transactional firewall must reject malicious slug: ${malicious}`
    );
  }

  const maliciousSessions = [
    '../../etc/shadow',
    '../../../etc/passwd',
    'session..traversal'
  ];

  for (const session of maliciousSessions) {
    assert.throws(
      () => validateSessionId(session),
      /directory traversal/,
      `Transactional firewall must reject session traversal: ${session}`
    );
  }
});
