/**
 * @dsh-dds/core — Universal Semantic LLM Gateway
 *
 * Provides in-memory protocol normalization, thought-signature preservation,
 * and an anti-compaction circuit breaker across Google Gemini, OpenAI,
 * Anthropic, DeepSeek, and local inference engines.
 */

export class LlmSemanticGateway {
  constructor(ctx, config = {}) {
    this.ctx = ctx;
    this.config = config;
    this.thoughtSignatures = new Map(); // Keyed by tool_call_id
    this.maxThoughtSignatures = config.maxThoughtSignatures || 1000;
  }

  install() {
    if (!this.ctx) return;

    if (typeof this.ctx.inject === 'function') {
      this.ctx.inject(['llm'], (llmCtx) => {
        this.attachToLlmService(llmCtx.llm);
      });
    } else if (this.ctx.llm) {
      this.attachToLlmService(this.ctx.llm);
    }

    // Also attempt prototype decoration on LlmRuntime if loaded
    try {
      import('@deepseek-ai/dsh-llm').then(({ LlmRuntime }) => {
        if (LlmRuntime?.prototype && !LlmRuntime.prototype.__ddsGatewayInstalled) {
          this.decorateLlmRuntime(LlmRuntime.prototype);
          LlmRuntime.prototype.__ddsGatewayInstalled = true;
        }
      }).catch(() => {});
    } catch {}
  }

  attachToLlmService(llmService) {
    if (!llmService || llmService.__ddsGatewayAttached) return;
    llmService.__ddsGatewayAttached = true;
    console.log('🛡️  [@dsh-dds/core] Universal LLM Semantic Protocol Gateway active.');
  }

  decorateLlmRuntime(proto) {
    const self = this;
    const origAdapterStream = proto.adapterStream;

    if (typeof origAdapterStream === 'function') {
      proto.adapterStream = async function*(options, prepared) {
        // 1. Sanitize options and normalize provider protocol
        const normalizedOptions = self.normalizeRequestOptions(options);

        // 2. Stream execution with anti-compaction error interceptor
        const stream = origAdapterStream.call(this, normalizedOptions, prepared);

        for await (const chunk of stream) {
          // Capture thought signatures on tool calls
          if (chunk.type === 'tool-call' || chunk.type === 'tool-calls') {
            self.captureThoughtSignatures(chunk);
          }

          // Anti-compaction circuit breaker: intercept false CONTEXT_WINDOW_EXCEEDED
          if (chunk.type === 'finish' && chunk.reason?.kind === 'error') {
            const failure = chunk.reason.failure;
            if (failure && failure.code === 'CONTEXT_WINDOW_EXCEEDED') {
              const errMsg = String(failure.message || '');
              // If it's a 400 (no body) or protocol error rather than a genuine token overflow
              if (errMsg.includes('400') && (errMsg.includes('no body') || !errMsg.toLowerCase().includes('token'))) {
                // Determine approximate prompt length
                const approxChars = JSON.stringify(normalizedOptions.messages || []).length;
                if (approxChars < 200000) { // Well under modern 1M context limits
                  failure.code = 'PROVIDER_PROTOCOL_ERROR';
                  failure.message = `Provider returned HTTP 400 Bad Request (not a context overflow): ${errMsg}`;
                  console.warn('⚠️  [@dsh-dds/core] Overrode false CONTEXT_WINDOW_EXCEEDED to prevent compaction loop:', errMsg);
                }
              }
            }
          }

          yield chunk;
        }
      };
    }
  }

  normalizeRequestOptions(options) {
    if (!options || !Array.isArray(options.messages)) return options;

    let modified = false;
    const messages = options.messages.map((msg) => {
      // Re-inject cached thought signatures for Google Gemini / tool returns
      if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
        let callsModified = false;
        const tool_calls = msg.tool_calls.map((tc) => {
          if (!tc.extra_content && this.thoughtSignatures.has(tc.id)) {
            callsModified = true;
            return { ...tc, extra_content: this.thoughtSignatures.get(tc.id) };
          }
          return tc;
        });
        if (callsModified) {
          modified = true;
          return { ...msg, tool_calls };
        }
      }
      return msg;
    });

    // Sanitize parameters for reasoning models (e.g. o1/o3-mini or deepseek-reasoner reject temperature)
    const isReasoningModel = options.model?.includes('o1') ||
      options.model?.includes('o3') ||
      options.model?.includes('reasoner') ||
      options.model?.includes('r1');

    if (isReasoningModel && options.temperature !== undefined) {
      const sanitized = { ...options, messages };
      delete sanitized.temperature;
      return sanitized;
    }

    return modified ? { ...options, messages } : options;
  }

  captureThoughtSignatures(chunk) {
    try {
      const toolCalls = chunk.tool_calls || (chunk.tool_call ? [chunk.tool_call] : []);
      for (const tc of toolCalls) {
        if (tc && tc.id && tc.extra_content) {
          if (this.thoughtSignatures.size >= this.maxThoughtSignatures) {
            const oldestKey = this.thoughtSignatures.keys().next().value;
            if (oldestKey !== undefined) {
              this.thoughtSignatures.delete(oldestKey);
            }
          }
          this.thoughtSignatures.set(tc.id, tc.extra_content);
        }
      }
    } catch {}
  }
}

export function registerLlmGateway(ctx, config) {
  const gateway = new LlmSemanticGateway(ctx, config);
  gateway.install();
  return gateway;
}
