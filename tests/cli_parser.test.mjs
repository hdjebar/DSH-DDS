import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePersonaArgs } from '../config/persona.mjs';

test('CLI Parser: defaults and basic commands', () => {
  const parsedList = parsePersonaArgs(['list']);
  assert.equal(parsedList.command, 'list');
  assert.equal(parsedList.tier, 'default');
  assert.equal(parsedList.profile, 'headless');

  const parsedShow = parsePersonaArgs(['show', 'data-analyst']);
  assert.equal(parsedShow.command, 'show');
  assert.deepEqual(parsedShow.positionalArgs, ['data-analyst']);
});

test('CLI Parser: standard options and prompt with spaces', () => {
  const parsed = parsePersonaArgs([
    'run',
    'data-analyst',
    '--tier',
    'reasoning',
    '--profile',
    'web',
    'audit',
    'database',
    'for',
    'nulls'
  ]);
  assert.equal(parsed.command, 'run');
  assert.equal(parsed.tier, 'reasoning');
  assert.equal(parsed.profile, 'web');
  assert.deepEqual(parsed.positionalArgs, ['data-analyst', 'audit', 'database', 'for', 'nulls']);
});

test('CLI Parser: key=value option syntax (--option=value)', () => {
  const parsed = parsePersonaArgs([
    'run',
    'sdmx-expert',
    '--tier=audit',
    '--profile=web',
    'query LUSTAT inflation'
  ]);
  assert.equal(parsed.command, 'run');
  assert.equal(parsed.tier, 'audit');
  assert.equal(parsed.profile, 'web');
  assert.deepEqual(parsed.positionalArgs, ['sdmx-expert', 'query LUSTAT inflation']);
});

test('CLI Parser: short options (-t, -p)', () => {
  const parsed = parsePersonaArgs([
    'run',
    'devops-sre',
    '-t',
    'fast',
    '-p',
    'headless',
    'check cluster memory'
  ]);
  assert.equal(parsed.command, 'run');
  assert.equal(parsed.tier, 'fast');
  assert.equal(parsed.profile, 'headless');
  assert.deepEqual(parsed.positionalArgs, ['devops-sre', 'check cluster memory']);
});

test('CLI Parser: mixed argument ordering', () => {
  const parsed = parsePersonaArgs([
    'run',
    '--profile=web',
    'security-auditor',
    '--tier',
    'audit',
    'review code diff'
  ]);
  assert.equal(parsed.command, 'run');
  assert.equal(parsed.tier, 'audit');
  assert.equal(parsed.profile, 'web');
  assert.deepEqual(parsed.positionalArgs, ['security-auditor', 'review code diff']);
});

test('CLI Parser: create command template flag', () => {
  const parsed1 = parsePersonaArgs(['create', 'fintech-advisor', '--template', 'data-analyst']);
  assert.equal(parsed1.command, 'create');
  assert.equal(parsed1.template, 'data-analyst');
  assert.deepEqual(parsed1.positionalArgs, ['fintech-advisor']);

  const parsed2 = parsePersonaArgs(['create', 'fintech-advisor', '--template=data-analyst']);
  assert.equal(parsed2.template, 'data-analyst');
});

test('CLI Parser: distill session option', () => {
  const parsed = parsePersonaArgs(['distill', 'custom-agent', '--session', 'sess-12345']);
  assert.equal(parsed.command, 'distill');
  assert.equal(parsed.sessionId, 'sess-12345');
  assert.deepEqual(parsed.positionalArgs, ['custom-agent']);
});

test('CLI Parser: rejects missing option values', () => {
  assert.throws(() => parsePersonaArgs(['run', 'data-analyst', '--tier']), /Missing value for option '--tier'/);
  assert.throws(() => parsePersonaArgs(['run', 'data-analyst', '--profile']), /Missing value for option '--profile'/);
  assert.throws(() => parsePersonaArgs(['run', 'data-analyst', '--tier=']), /Missing value for option '--tier='/);
  assert.throws(() => parsePersonaArgs(['run', 'data-analyst', '--tier', '-p', 'web']), /Missing value for option '--tier'/);
});

test('CLI Parser: rejects unknown options', () => {
  assert.throws(() => parsePersonaArgs(['run', 'data-analyst', '--unknown-flag', 'test']), /Unknown option '--unknown-flag'/);
});

test('Structured YAML Parser: handles nested mappings, quotes, comments and scalar types', async () => {
  const { parseYaml } = await import('../config/persona.mjs');
  const yaml = `
# Top-level comment
name: test-agent # inline comment
version: "1.0"
description: 'Specialized agent with "quotes" and symbols'
enabled: true
maxRetries: 5
temperature: 0.75

# Matrix configuration
profiles:
  - web
  - headless
  - cli

models:
  default:
    provider: openrouter
    model: deepseek/deepseek-chat
    temperature: 0.2
    useCase: "General querying and reasoning"
  audit:
    provider: anthropic
    model: claude-3.5-sonnet

workflows:
  quick-check:
    modelTier: default
    command: "perform standard integrity check"
`;

  const parsed = parseYaml(yaml);
  assert.equal(parsed.name, 'test-agent');
  assert.equal(parsed.version, '1.0');
  assert.equal(parsed.description, 'Specialized agent with "quotes" and symbols');
  assert.equal(parsed.enabled, true);
  assert.equal(parsed.maxRetries, 5);
  assert.equal(parsed.temperature, 0.75);
  assert.deepEqual(parsed.profiles, ['web', 'headless', 'cli']);
  assert.equal(parsed.models.default.provider, 'openrouter');
  assert.equal(parsed.models.default.model, 'deepseek/deepseek-chat');
  assert.equal(parsed.models.default.temperature, 0.2);
  assert.equal(parsed.models.audit.provider, 'anthropic');
  assert.equal(parsed.workflows['quick-check'].command, 'perform standard integrity check');
});

test('Structured YAML Parser: handles block scalars (|) and inline flow mappings ({})', async () => {
  const { parseYaml } = await import('../config/persona.mjs');
  const yaml = `
description: |
  This is a multiline
  block scalar documentation text.
flow: { enabled: true, retries: 2, strategy: "exponential" }
tags: [ai, deepseek, automation]
`;

  const parsed = parseYaml(yaml);
  assert.equal(parsed.description.trim(), 'This is a multiline\nblock scalar documentation text.');
  assert.deepEqual(parsed.flow, { enabled: true, retries: 2, strategy: 'exponential' });
  assert.deepEqual(parsed.tags, ['ai', 'deepseek', 'automation']);
});

test('CLI Parser: distill title option (--title and --title=)', () => {
  const parsed1 = parsePersonaArgs(['distill', 'stats-engineer', '--title', 'Statistical Engineer']);
  assert.equal(parsed1.command, 'distill');
  assert.equal(parsed1.title, 'Statistical Engineer');
  assert.deepEqual(parsed1.positionalArgs, ['stats-engineer']);

  const parsed2 = parsePersonaArgs(['distill', 'stats-engineer', '--title=Statistical Engineer']);
  assert.equal(parsed2.title, 'Statistical Engineer');

  assert.throws(() => parsePersonaArgs(['distill', 'stats-engineer', '--title']), /Missing value for option '--title'/);
  assert.throws(() => parsePersonaArgs(['distill', 'stats-engineer', '--title=']), /Missing value for option '--title='/);
});

test('Secret Scrubber: redacts Google AI Studio keys and GitHub fine-grained PATs', async () => {
  const { scrubSecrets } = await import('../config/persona.mjs');
  const mockGemini = ['AIza', 'SyD3x918ABCD1234567890abcdefghijklm'].join('');
  const mockPat = ['github', 'pat', '11' + 'A'.repeat(80)].join('_');
  const mockApiKey = ['sk', '1234567890123456789012'].join('-');
  const rawText = `Keys: ${mockGemini} and ${mockPat} and ${mockApiKey}`;
  const scrubbed = scrubSecrets(rawText);
  assert.ok(!scrubbed.includes('SyD3x918'));
  assert.ok(!scrubbed.includes(mockPat));
  assert.ok(scrubbed.includes('[REDACTED_GEMINI_KEY]'));
  assert.ok(scrubbed.includes('[REDACTED_GITHUB_PAT]'));
  assert.ok(scrubbed.includes('[REDACTED_API_KEY]'));
});

test('CLI Parser: workflow approval options (--approve, --approved)', () => {
  const parsed1 = parsePersonaArgs(['workflow', 'security-auditor', 'incident_triage', '--approve']);
  assert.equal(parsed1.command, 'workflow');
  assert.equal(parsed1.approved, true);

  const parsed2 = parsePersonaArgs(['wf', 'security-auditor', 'incident_triage', '--approved']);
  assert.equal(parsed2.command, 'wf');
  assert.equal(parsed2.approved, true);
});

test('CLI Parser: context options (--context and --context=)', () => {
  const parsed1 = parsePersonaArgs(['workflow', 'sec', 'wf', '--context', '{"case_id":"123"}']);
  assert.deepEqual(parsed1.context, { case_id: '123' });

  const parsed2 = parsePersonaArgs(['workflow', 'sec', 'wf', '--context={"case_id":"456"}']);
  assert.deepEqual(parsed2.context, { case_id: '456' });

  assert.throws(() => parsePersonaArgs(['workflow', 'sec', 'wf', '--context', '{invalid']), /Invalid JSON/);
});

test('CLI Parser: accepts --force-host-unsafe flag', () => {
  const parsed = parsePersonaArgs(['workflow', 'sec', 'wf', '--force-host-unsafe']);
  assert.equal(parsed.forceHostUnsafe, true);
});

test('Persona Creation: transactional creation does not leave partial dir on invalid template (AUD-013)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { createPersona } = await import('../config/persona.mjs');

  const testPersonaName = 'tmp-test-invalid-tmpl-' + Date.now();
  const targetDir = path.join(process.cwd(), 'config', 'personas', testPersonaName);

  const prevExitCode = process.exitCode;
  try {
    createPersona(testPersonaName, 'non-existent-template-xyz');
    assert.equal(fs.existsSync(targetDir), false, 'target directory must not exist after invalid template creation');
  } finally {
    process.exitCode = prevExitCode || 0;
  }
});

test('FR-010 Regression: dsh.sh approve rejects command injection payloads and validates slug format', async () => {
  const { execFileSync } = await import('node:child_process');
  const path = await import('node:path');
  const dshScript = path.resolve(process.cwd(), 'dsh.sh');

  const injectionPayloads = [
    "'; console.log('PWNED'); process.exit(0); '",
    'test;rm -rf /',
    'id`touch pwned`',
    'instance with spaces',
    '../../etc/passwd',
    'id$(whoami)',
    'id&echo pwned'
  ];

  const testEnv = { ...process.env, DSH_APPROVAL_SECRET: 'test-approval-secret-32-chars-long' };

  for (const payload of injectionPayloads) {
    let thrown = false;
    try {
      execFileSync(dshScript, ['approve', payload], { stdio: 'pipe', env: testEnv });
    } catch (err) {
      thrown = true;
      assert.equal(err.status, 1);
      const stderr = err.stderr ? err.stderr.toString() : '';
      assert.ok(
        stderr.includes('Invalid instance ID') || stderr.includes('Only alphanumeric'),
        `Payload '${payload}' must be rejected with slug validation error, got: ${stderr}`
      );
    }
    assert.equal(thrown, true, `Injection payload '${payload}' must exit with non-zero code`);
  }
});

test('FR-009 Regression: dsh.sh approve fails closed when DSH_APPROVAL_SECRET is absent', async () => {
  const { execSync } = await import('node:child_process');
  const path = await import('node:path');
  const dshScript = path.resolve(process.cwd(), 'dsh.sh');

  let thrown = false;
  try {
    execSync(`"${dshScript}" approve "valid-instance-id"`, {
      stdio: 'pipe',
      env: { ...process.env, DSH_APPROVAL_SECRET: '', DSH_SECRET: '', DSH_APPROVAL_PRIVATE_KEY: '' }
    });
  } catch (err) {
    thrown = true;
    assert.equal(err.status, 1);
    const stderr = err.stderr ? err.stderr.toString() : '';
    assert.ok(
      stderr.includes('APPROVAL_SECRET_MISSING') || stderr.includes('DSH_APPROVAL_SECRET'),
      `Missing secret must fail closed with APPROVAL_SECRET_MISSING error, got: ${stderr}`
    );
  }
  assert.equal(thrown, true, 'dsh.sh approve must exit with non-zero when secret is missing');
});

test('FR-011 CLI Regression: dsh.sh approve parses --actor and --ttl options and validates formats', async () => {
  const { execFileSync } = await import('node:child_process');
  const path = await import('node:path');
  const fs = await import('node:fs');
  const dshScript = path.resolve(process.cwd(), 'dsh.sh');
  const testEnv = { ...process.env, DSH_APPROVAL_SECRET: 'test-approval-secret-32-chars-long' };

  // 1. Rejects invalid actor formats
  for (const badActor of ['invalid actor', 'bad;actor', 'foo$bar']) {
    assert.throws(() => {
      execFileSync(dshScript, ['approve', 'test-inst', `--actor=${badActor}`], { stdio: 'pipe', env: testEnv });
    }, /Invalid actor/);
  }

  // 2. Rejects invalid TTL formats
  for (const badTtl of ['not-a-number', '-50', '3600s']) {
    assert.throws(() => {
      execFileSync(dshScript, ['approve', 'test-inst', `--ttl=${badTtl}`], { stdio: 'pipe', env: testEnv });
    }, /Invalid TTL/);
  }

  // 3. Generates approval token with custom actor and TTL (--option=value and --option value)
  const testInstanceId = `test-inst-cli-${Date.now()}`;
  const checkpointDir = path.join(process.cwd(), 'config', 'sessions', 'checkpoints');
  const checkpointFile = path.join(checkpointDir, `${testInstanceId}.json`);
  fs.mkdirSync(checkpointDir, { recursive: true });

  const mockCheckpoint = {
    instanceId: testInstanceId,
    persona: 'security-auditor',
    workflow: 'incident_triage',
    suspendedAtStep: 0,
    status: 'SUSPENDED_APPROVAL_REQUIRED',
    checkpointDigest: 'mock-digest-hash-0123456789abcdef0123456789abcdef'
  };
  fs.writeFileSync(checkpointFile, JSON.stringify(mockCheckpoint, null, 2), 'utf8');

  try {
    // Test --actor=value --ttl=value
    const out1 = execFileSync(
      dshScript,
      ['approve', testInstanceId, '--actor=compliance-officer', '--ttl=1800'],
      { stdio: 'pipe', env: testEnv, encoding: 'utf8' }
    );
    assert.ok(out1.includes(`Approved instance: ${testInstanceId}`));
    assert.ok(out1.includes('Actor: compliance-officer'));
    const tokenMatch1 = out1.match(/Approval Token:\s*([A-Za-z0-9_-]+\.[0-9]+\.[A-Za-z0-9_-]+)/);
    assert.ok(tokenMatch1, 'Approval token must be present in stdout');
    const parts1 = tokenMatch1[1].split('.');
    assert.equal(parts1[0], 'compliance-officer');
    const exp1 = Number(parts1[1]);
    assert.ok(exp1 > Date.now());
    assert.ok(exp1 <= Date.now() + 1801 * 1000);

    // Test --actor value --ttl value
    const out2 = execFileSync(
      dshScript,
      ['approve', testInstanceId, '--actor', 'lead-auditor', '--ttl', '7200'],
      { stdio: 'pipe', env: testEnv, encoding: 'utf8' }
    );
    assert.ok(out2.includes('Actor: lead-auditor'));
    const tokenMatch2 = out2.match(/Approval Token:\s*([A-Za-z0-9_-]+\.[0-9]+\.[A-Za-z0-9_-]+)/);
    assert.ok(tokenMatch2, 'Approval token must be present in stdout');
    const parts2 = tokenMatch2[1].split('.');
    assert.equal(parts2[0], 'lead-auditor');
    const exp2 = Number(parts2[1]);
    assert.ok(exp2 > Date.now() + 7000 * 1000);
  } finally {
    if (fs.existsSync(checkpointFile)) {
      fs.unlinkSync(checkpointFile);
    }
  }
});
