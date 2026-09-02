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
