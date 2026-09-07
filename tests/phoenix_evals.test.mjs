import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TrajectoryEvaluator,
  getTelemetryHeaders,
  validateCodeSyntax,
  GRADE_EXCELLENT,
  GRADE_ACCEPTABLE,
  GRADE_MARGINAL,
  GRADE_DEFICIENT,
  apply as applyEvalsPlugin
} from '../config/phoenix-evals.mjs';

test('validateCodeSyntax: validates JavaScript syntax accurately', () => {
  assert.equal(validateCodeSyntax('const a = 1; export default a;'), true);
  assert.equal(validateCodeSyntax('function hello() { return "world"; }'), true);
  assert.equal(validateCodeSyntax('const a = ;'), false);
  assert.equal(validateCodeSyntax('function () {'), false);
  assert.equal(validateCodeSyntax(''), true);
});

test('getTelemetryHeaders: generates authenticated headers when configured', () => {
  // Empty env
  const defaultHeaders = getTelemetryHeaders({});
  assert.equal(defaultHeaders['Content-Type'], 'application/json');
  assert.equal(defaultHeaders['Authorization'], undefined);

  // With API Key
  const authedHeaders = getTelemetryHeaders({ PHOENIX_API_KEY: 'secret-key-123' });
  assert.equal(authedHeaders['Authorization'], 'Bearer secret-key-123');
  assert.equal(authedHeaders['x-phoenix-api-key'], 'secret-key-123');

  // With Auth Enabled
  const authEnabledHeaders = getTelemetryHeaders({ PHOENIX_ENABLE_AUTH: 'true' });
  assert.ok(authEnabledHeaders['Authorization'].startsWith('Bearer '));
});

test('TrajectoryEvaluator: computes 1.0 EXCELLENT for clean, successful workflow', () => {
  const evaluator = new TrajectoryEvaluator();
  const workflow = {
    status: 'COMPLETED',
    steps: [
      { id: 'fetch', success: true, action: 'fetch_sources' },
      { id: 'analyze', success: true, action: 'forensic_investigation' },
      { id: 'patch', success: true, action: 'apply_fix_or_patch', codeContent: 'export const fixed = true;' }
    ]
  };

  const report = evaluator.evaluateWorkflow(workflow);
  assert.equal(report.score, 1.0);
  assert.equal(report.grade, GRADE_EXCELLENT);
  assert.equal(report.metrics.toolAccuracy, 1.0);
  assert.equal(report.metrics.rbacCompliance, 1.0);
  assert.equal(report.metrics.codeSyntax, 1.0);
  assert.equal(report.stats.passedSteps, 3);
  assert.equal(report.stats.failedSteps, 0);
  assert.equal(report.stats.violationCount, 0);
});

test('TrajectoryEvaluator: penalizes tool execution failures proportionally', () => {
  const evaluator = new TrajectoryEvaluator();
  const workflow = {
    status: 'PARTIAL',
    steps: [
      { id: 's1', success: true },
      { id: 's2', success: false, error: 'Network timeout' },
      { id: 's3', success: true },
      { id: 's4', success: false, error: 'Database connection dropped' }
    ]
  };

  const report = evaluator.evaluateWorkflow(workflow);
  // Tool accuracy is 2/4 = 0.5; RBAC is 1.0; Code syntax is 1.0
  // Score = (0.5 * 0.40) + (1.0 * 0.35) + (1.0 * 0.25) = 0.20 + 0.35 + 0.25 = 0.80
  assert.equal(report.metrics.toolAccuracy, 0.5);
  assert.equal(report.score, 0.80);
  assert.equal(report.grade, GRADE_ACCEPTABLE);
});

test('TrajectoryEvaluator: detects RBAC violations and reduces compliance score', () => {
  const evaluator = new TrajectoryEvaluator();
  const workflow = {
    status: 'FAILED',
    steps: [
      { id: 's1', success: true },
      { id: 's2', success: false, code: 'RBAC_DENY_VIOLATION', error: 'RBAC Policy: path /etc/shadow is denied' }
    ]
  };

  const report = evaluator.evaluateWorkflow(workflow);
  // Tool accuracy is 1/2 = 0.5 (weight 0.4 -> 0.20)
  // RBAC compliance is 1.0 - 0.25 = 0.75 (weight 0.35 -> 0.2625)
  // Syntax is 1.0 (weight 0.25 -> 0.25)
  // Score ~ 0.713
  assert.equal(report.stats.violationCount, 1);
  assert.equal(report.metrics.rbacCompliance, 0.75);
  assert.ok(report.score < 0.75);
  assert.equal(report.grade, GRADE_MARGINAL);
});

test('TrajectoryEvaluator: detects code syntax failures', () => {
  const evaluator = new TrajectoryEvaluator();
  const workflow = {
    status: 'COMPLETED',
    steps: [
      { id: 'write', success: true, codeContent: 'const invalid JS = ;;;' }
    ]
  };

  const report = evaluator.evaluateWorkflow(workflow);
  // Tool accuracy = 1.0 (0.40); RBAC = 1.0 (0.35); Syntax = 0.0 (0.00)
  // Score = 0.75
  assert.equal(report.metrics.codeSyntax, 0.0);
  assert.equal(report.score, 0.75);
  assert.equal(report.grade, GRADE_ACCEPTABLE);
});

test('TrajectoryEvaluator: classifies DEFICIENT on compounding failures', () => {
  const evaluator = new TrajectoryEvaluator();
  const workflow = {
    status: 'FAILED',
    steps: [
      { id: 's1', success: false, code: 'RBAC_DENY_VIOLATION', error: 'RBAC path traversal escape' },
      { id: 's2', success: false, code: 'RBAC_TARGET_INVALID', error: 'RBAC target required' },
      { id: 's3', success: false, codeContent: 'const broken = {;' }
    ]
  };

  const report = evaluator.evaluateWorkflow(workflow);
  assert.equal(report.metrics.toolAccuracy, 0.0);
  assert.equal(report.metrics.rbacCompliance, 0.5); // 2 violations * 0.25 penalty
  assert.equal(report.metrics.codeSyntax, 0.0);
  assert.ok(report.score < 0.50);
  assert.equal(report.grade, GRADE_DEFICIENT);
});

test('TrajectoryEvaluator: records evaluation span to Phoenix tracer', async () => {
  const evaluator = new TrajectoryEvaluator();
  const spansSent = [];
  const mockTracer = {
    async sendSpan(spanData) {
      spansSent.push(spanData);
      return true;
    }
  };

  const workflow = {
    status: 'COMPLETED',
    steps: [{ id: 's1', success: true }]
  };
  const evalResult = evaluator.evaluateWorkflow(workflow);

  const sent = await evaluator.recordEvaluation(mockTracer, evalResult, {
    workflow: 'test-wf',
    persona: 'security-auditor',
    traceId: '1234567890abcdef1234567890abcdef'
  });

  assert.equal(sent, true);
  assert.equal(spansSent.length, 1);
  const span = spansSent[0];
  assert.equal(span.name, 'eval.trajectory_grader');
  assert.equal(span.attributes['eval.score'], 1.0);
  assert.equal(span.attributes['eval.grade'], GRADE_EXCELLENT);
  assert.equal(span.traceId, '1234567890abcdef1234567890abcdef');
});

test('Cordis Plugin: registers evals service on context', () => {
  const ctx = {};
  applyEvalsPlugin(ctx);
  assert.ok(ctx.evals instanceof TrajectoryEvaluator);
});
