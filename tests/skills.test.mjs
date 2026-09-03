import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SKILLS_DIR = path.join(ROOT, 'config', 'skills');

test('Skill Catalog Verification: all 7 domain skills contain valid instructions and operational guidelines', () => {
  const skills = [
    'data-analyst',
    'devops-sre',
    'mlops-engineer',
    'persona-creator',
    'sdmx-expert',
    'security-auditor',
    'stats-engineer'
  ];

  for (const name of skills) {
    const skillFile = path.join(SKILLS_DIR, name, 'SKILL.md');
    assert.ok(fs.existsSync(skillFile), `SKILL.md must exist for ${name}`);

    const content = fs.readFileSync(skillFile, 'utf8');
    assert.ok(content.length > 100, `Skill ${name} must have substantial content (> 100 bytes)`);
    assert.match(content, /Role & Objective/i, `Skill ${name} must define Role & Objective`);
    assert.match(content, /Guidelines|Actions|Instructions/i, `Skill ${name} must define Guidelines or Actions`);
  }
});
