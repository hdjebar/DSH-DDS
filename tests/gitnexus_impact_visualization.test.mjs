import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertAuthoritativeImpact,
  assertCleanGitStatus,
  assertFreshStatus,
  buildImpactArchitecture,
} from '../scripts/render_gitnexus_impact.mjs';

const revision = 'a'.repeat(40);

test('worktree guard requires impact evidence to be generated before edits', () => {
  assert.doesNotThrow(() => assertCleanGitStatus(''));
  assert.throws(() => assertCleanGitStatus(' M config/example.mjs'), /before editing/);
});

function freshStatus(overrides = {}) {
  return {
    status: 'up-to-date',
    repository: process.cwd(),
    workspaceIndexBranch: null,
    index: { commit: revision, runnerIdentityStatus: 'current', incompleteReasons: [] },
    current: { commit: revision },
    contentDrift: { status: 'current' },
    ...overrides,
  };
}

function impactFixture(overrides = {}) {
  return {
    target: { id: 'Function:config/example.mjs:target', name: 'target', type: 'Function', filePath: 'config/example.mjs', startLine: 10, endLine: 20 },
    direction: 'upstream',
    impactedCount: 11,
    risk: 'HIGH',
    epistemic: 'exact',
    summary: { direct: 5, processes_affected: 2, modules_affected: 1 },
    byDepthCounts: { 1: 5, 2: 6 },
    affected_processes: [
      { id: 'proc_1', summary: 'Request authorization flow' },
      { id: 'proc_2', summary: 'Workflow resume flow' },
    ],
    affected_modules: ['Config'],
    byDepth: {
      1: Array.from({ length: 5 }, (_, index) => ({ id: `Function:test/direct-${index}`, name: `direct${index}`, filePath: `config/direct-${index}.mjs`, depth: 1 })),
      2: Array.from({ length: 6 }, (_, index) => ({ id: `Function:test/transitive-${index}`, name: `transitive${index}`, filePath: `config/transitive-${index}.mjs`, depth: 2 })),
    },
    ...overrides,
  };
}

test('GitNexus status guard accepts only a fresh complete index', () => {
  assert.equal(assertFreshStatus(freshStatus()), revision);
  assert.throws(() => assertFreshStatus(freshStatus({ status: 'stale' })), /not authoritative/);
  assert.throws(
    () => assertFreshStatus(freshStatus({ index: { commit: revision, runnerIdentityStatus: 'current', incompleteReasons: ['parse failure'] } })),
    /index is incomplete/
  );
});

test('impact guard rejects ambiguous, partial, stale, truncated, and unknown-risk results', () => {
  const uid = 'Function:config/example.mjs:target';
  assert.equal(assertAuthoritativeImpact(impactFixture(), uid).risk, 'HIGH');
  assert.throws(() => assertAuthoritativeImpact(impactFixture({ status: 'ambiguous' }), uid), /ambiguous/);
  assert.throws(() => assertAuthoritativeImpact(impactFixture({ partial: true }), uid), /partial or truncated/);
  assert.throws(() => assertAuthoritativeImpact(impactFixture({ staleness: { commitsBehind: 1 } }), uid), /stale/);
  assert.throws(() => assertAuthoritativeImpact(impactFixture({ pagination: { truncated: true } }), uid), /partial or truncated/);
  assert.throws(() => assertAuthoritativeImpact(impactFixture({ risk: 'UNKNOWN' }), uid), /manual review/);
  assert.throws(() => assertAuthoritativeImpact(impactFixture({ epistemic: 'lower-bound' }), uid), /not exact/);
  assert.throws(() => assertAuthoritativeImpact(impactFixture({ impactedCount: 12 }), uid), /does not match/);
  assert.throws(() => assertAuthoritativeImpact(impactFixture({ byDepthCounts: { 1: 4, 2: 6 } }), uid), /declared count/);
});

test('impact adapter creates a bounded deterministic architecture with provenance and rollup', () => {
  const spec = buildImpactArchitecture(impactFixture(), {
    revision,
    repositoryUrl: 'https://github.com/hdjebar/DSH-DDS',
  });
  assert.equal(spec.schema_version, 1);
  assert.equal(spec.diagram_type, 'architecture');
  assert.equal(spec.meta.quality_profile, 'showcase');
  assert.equal(spec.meta.repository.revision, revision);
  assert.ok(spec.components.length <= 12);
  assert.equal(spec.components[0].id, 'target');
  assert.equal(spec.components[1].id, 'impact_surface');
  assert.ok(spec.components.some((component) => component.id === 'impact_rollup'));
  assert.ok(spec.components.some((component) => component.sources?.[0]?.path === 'config/direct-0.mjs'));
  assert.equal(spec.connections.filter((connection) => connection.from === 'target').length, 1);
  assert.ok(spec.connections.slice(1).every((connection) => connection.from === 'impact_surface'));
  assert.match(JSON.stringify(spec.cards), /Full machine result retained/);
});
