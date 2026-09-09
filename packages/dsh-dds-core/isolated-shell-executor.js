import http from 'node:http';
import path from 'node:path';
import { ShellExecutor } from '@deepseek-ai/dsh-shell';
import { getCurrentExecutionCapability, verifyExecutionCapability } from './execution-capability.js';

const DEFAULT_SOCKET = '/run/dsh-executor/executor.sock';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_TIMEOUT_MS = 120_000;
const DEFAULT_OUTPUT_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 512 * 1024;

function positive(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const candidate = Number(value ?? fallback);
  if (!Number.isFinite(candidate) || candidate <= 0) throw new Error('Executor limits must be positive numbers');
  return Math.min(candidate, max);
}

function postToExecutor(socketPath, payload, signal) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const request = http.request({
      socketPath,
      path: '/v1/execute',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': body.length },
      signal
    });
    const chunks = [];
    let bytes = 0;
    request.on('response', response => {
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE_BYTES) {
          request.destroy(new Error('Isolated executor response exceeded its limit'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {
          reject(new Error('Isolated executor returned an invalid response'));
          return;
        }
        if (response.statusCode !== 200) {
          reject(new Error(`Isolated executor rejected the request: ${parsed.error || response.statusCode}`));
          return;
        }
        resolve(parsed);
      });
    });
    request.on('error', reject);
    request.end(body);
  });
}

export class IsolatedShellExecutor extends ShellExecutor {
  constructor(ctx, config = {}) {
    super(ctx);
    this.socketPath = config.socketPath || process.env.DSH_EXECUTOR_SOCKET || DEFAULT_SOCKET;
    this.defaultWorkdir = config.cwd || '/workspaces/cases';
    this.timeoutMs = positive(config.timeoutMs, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_TIMEOUT_MS);
    this.maxTimeoutMs = positive(config.maxTimeoutMs, DEFAULT_MAX_TIMEOUT_MS, DEFAULT_MAX_TIMEOUT_MS);
    this.maxOutputBytes = positive(config.maxOutputBytes, DEFAULT_OUTPUT_BYTES, 256 * 1024);
  }

  get sandboxMode() { return 'workspace-write'; }

  resolve(request) {
    const workdir = path.resolve(request.workdir || this.defaultWorkdir);
    const capability = getCurrentExecutionCapability();
    if (!capability) throw new Error('Isolated shell execution requires a PEP-issued capability');
    verifyExecutionCapability(capability, { workdir });
    return {
      command: request.command,
      workdir,
      timeoutMs: positive(request.timeoutMs, this.timeoutMs, this.maxTimeoutMs),
      stdoutMaxBytes: positive(request.stdoutMaxBytes, this.maxOutputBytes, this.maxOutputBytes),
      signal: request.signal,
      stdin: request.stdin,
      env: request.env,
      dshEnv: request.dshEnv,
      sandboxPolicy: request.sandboxPolicy,
      executionCapability: capability
    };
  }

  async run(spec) {
    return postToExecutor(this.socketPath, {
      capability: spec.executionCapability,
      command: spec.command,
      workdir: spec.workdir,
      timeoutMs: spec.timeoutMs,
      stdoutMaxBytes: spec.stdoutMaxBytes,
      stdin: spec.stdin,
      env: { ...spec.env, ...spec.dshEnv }
    }, spec.signal);
  }

  start(spec) {
    const controller = new AbortController();
    if (spec.signal) spec.signal.addEventListener('abort', () => controller.abort(), { once: true });
    let output = '';
    let outputOffset = 0;
    const proc = {
      status: 'running',
      exitCode: null,
      signal: null,
      sandbox: undefined,
      done: null,
      readOutput() {
        const delta = output.slice(outputOffset);
        outputOffset = output.length;
        return { delta, lossy: false };
      },
      kill() {
        if (proc.status !== 'running') return false;
        controller.abort();
        return true;
      }
    };
    proc.done = this.run({ ...spec, signal: controller.signal }).then(result => {
      proc.status = result.signal ? 'killed' : 'completed';
      proc.exitCode = result.exitCode;
      proc.signal = result.signal;
      proc.sandbox = result.sandbox;
      output = result.stdout.text + (result.stderr.text ? `${result.stdout.text ? '\n' : ''}[stderr]\n${result.stderr.text}` : '');
    }, error => {
      proc.status = 'killed';
      output = `spawn failed: ${String(error)}`;
    });
    return proc;
  }
}

export default IsolatedShellExecutor;
