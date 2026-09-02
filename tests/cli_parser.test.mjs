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
