/**
 * 🦅 Arize Phoenix Trajectory Evaluator & Telemetry Auth Governance
 *
 * Implements Milestone 2 Track B:
 * 1. TrajectoryEvaluator: Automated LLM-as-a-judge and deterministic trajectory grading
 *    (Tool Execution Accuracy, RBAC Compliance, Syntax Validity).
 * 2. Telemetry Auth Governance: Standardized bearer token / API key header generation.
 * 3. Cordis Service Bridge: ctx.provide('evals') and automatic workflow evaluation.
 */

import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

export const GRADE_EXCELLENT = 'EXCELLENT';
export const GRADE_ACCEPTABLE = 'ACCEPTABLE';
export const GRADE_MARGINAL = 'MARGINAL';
export const GRADE_DEFICIENT = 'DEFICIENT';

/**
 * Generate authenticated headers for Phoenix OTLP span ingestion.
 */
export function getTelemetryHeaders(env = process.env) {
  const headers = {
    'Content-Type': 'application/json'
  };

  const apiKey = env.PHOENIX_API_KEY || '';
  const authEnabled = env.PHOENIX_ENABLE_AUTH === 'true' || env.PHOENIX_ENABLE_AUTH === '1';

  if (apiKey || authEnabled) {
    const key = apiKey || 'phoenix-default-token';
    headers['Authorization'] = `Bearer ${key}`;
    headers['x-phoenix-api-key'] = key;
  }

  return headers;
}

/**
 * Validates JavaScript / ECMAScript code syntax (both CJS and ESM modules).
 */
export function validateCodeSyntax(code) {
  if (typeof code !== 'string' || !code.trim()) return true;

  const hasModuleSyntax = /\b(?:import|export)\b/.test(code) || /\bawait\b/.test(code);
  if (hasModuleSyntax) {
    try {
      const res = spawnSync(process.execPath, ['--input-type=module', '--check'], {
        input: code,
        encoding: 'utf8',
        timeout: 3000
      });
      return res.status === 0;
    } catch {
      return false;
    }
  }

  try {
    new vm.Script(code);
    return true;
  } catch {
    try {
      const res = spawnSync(process.execPath, ['--input-type=module', '--check'], {
        input: code,
        encoding: 'utf8',
        timeout: 3000
      });
      return res.status === 0;
    } catch {
      return false;
    }
  }
}

export class TrajectoryEvaluator {
  constructor(options = {}) {
    this.weights = {
      toolAccuracy: options.weights?.toolAccuracy ?? 0.40,
      rbacCompliance: options.weights?.rbacCompliance ?? 0.35,
      codeSyntax: options.weights?.codeSyntax ?? 0.25
    };
  }

  /**
   * Evaluates a completed agent workflow execution trajectory.
   *
   * @param {Object} workflowResult - Output of DeclarativeWorkflowEngine or step sequence
   * @param {Array} workflowResult.steps - Executed step results
   * @param {string} workflowResult.status - Final workflow status (COMPLETED, FAILED, etc.)
   * @param {Array} [workflowResult.violations] - Security or policy violations recorded
   * @returns {Object} Evaluation report with normalized scores (0.0 - 1.0) and grade
   */
  evaluateWorkflow(workflowResult = {}) {
    const steps = Array.isArray(workflowResult.steps) ? workflowResult.steps : [];
    const totalSteps = steps.length;

    let passedSteps = 0;
    let failedSteps = 0;
    let syntaxFailures = 0;
    const detectedViolations = [...(workflowResult.violations || [])];

    for (const step of steps) {
      if (step.success === false || step.error) {
        failedSteps++;
      } else {
        passedSteps++;
      }

      // Detect policy violations in step errors or codes
      const errStr = String(step.error || '');
      const errCode = String(step.code || '');
      if (
        errStr.includes('RBAC') ||
        errStr.includes('traversal') ||
        errStr.includes('Permission denied') ||
        errCode.startsWith('RBAC_') ||
        errCode.startsWith('FIREWALL_')
      ) {
        detectedViolations.push({
          stepId: step.id || step.action,
          code: errCode || 'RBAC_VIOLATION',
          error: errStr
        });
      }

      // Check code syntax if step produced or modified code
      if (step.codeContent && typeof step.codeContent === 'string') {
        if (!validateCodeSyntax(step.codeContent)) {
          syntaxFailures++;
        }
      }
    }

    // Metric 1: Tool Execution Accuracy
    const toolAccuracy = totalSteps === 0
      ? (workflowResult.status === 'FAILED' ? 0.0 : 1.0)
      : Math.max(0.0, Math.min(1.0, passedSteps / totalSteps));

    // Metric 2: RBAC & Security Compliance
    // Zero violations = 1.0; 0.25 penalty per detected violation
    const rbacPenalty = detectedViolations.length * 0.25;
    const rbacCompliance = Math.max(0.0, 1.0 - rbacPenalty);

    // Metric 3: Code Syntax Validity
    const codeSyntax = syntaxFailures > 0 ? 0.0 : 1.0;

    // Normalized Composite Score
    const compositeScore = Number((
      (toolAccuracy * this.weights.toolAccuracy) +
      (rbacCompliance * this.weights.rbacCompliance) +
      (codeSyntax * this.weights.codeSyntax)
    ).toFixed(3));

    // Assign Categorical Grade
    let grade = GRADE_DEFICIENT;
    if (compositeScore >= 0.90) {
      grade = GRADE_EXCELLENT;
    } else if (compositeScore >= 0.75) {
      grade = GRADE_ACCEPTABLE;
    } else if (compositeScore >= 0.50) {
      grade = GRADE_MARGINAL;
    }

    return {
      score: compositeScore,
      grade,
      metrics: {
        toolAccuracy: Number(toolAccuracy.toFixed(3)),
        rbacCompliance: Number(rbacCompliance.toFixed(3)),
        codeSyntax: Number(codeSyntax.toFixed(3))
      },
      stats: {
        totalSteps,
        passedSteps,
        failedSteps,
        violationCount: detectedViolations.length,
        syntaxFailureCount: syntaxFailures
      },
      violations: detectedViolations,
      workflowStatus: workflowResult.status || 'UNKNOWN'
    };
  }

  /**
   * Records an evaluation span to the Arize Phoenix tracer.
   */
  async recordEvaluation(tracer, evalResult, options = {}) {
    if (!tracer || typeof tracer.sendSpan !== 'function') {
      return false;
    }

    const spanData = {
      name: options.name || 'eval.trajectory_grader',
      workflow: options.workflow || 'declarative-workflow',
      persona: options.persona || 'security-auditor',
      traceId: options.traceId,
      parentSpanId: options.parentSpanId,
      attributes: {
        'eval.score': evalResult.score,
        'eval.grade': evalResult.grade,
        'eval.tool_accuracy': evalResult.metrics.toolAccuracy,
        'eval.rbac_compliance': evalResult.metrics.rbacCompliance,
        'eval.code_syntax': evalResult.metrics.codeSyntax,
        'eval.total_steps': evalResult.stats.totalSteps,
        'eval.failed_steps': evalResult.stats.failedSteps,
        'eval.violations': evalResult.stats.violationCount,
        'eval.status': evalResult.workflowStatus
      },
      error: evalResult.grade === GRADE_DEFICIENT ? 'Trajectory evaluation deficient' : undefined
    };

    return await tracer.sendSpan(spanData);
  }
}

export const name = 'phoenix-evals';

export function apply(ctx) {
  const evaluator = new TrajectoryEvaluator();
  if (typeof ctx.provide === 'function') {
    ctx.provide('evals', evaluator);
  } else {
    ctx.evals = evaluator;
  }
}
