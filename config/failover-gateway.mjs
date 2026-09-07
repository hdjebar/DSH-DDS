// config/failover-gateway.mjs
/**
 * ⚡ Native In-Flight Model Failover Gateway
 * Enforces Invariant 1 (Reliable Fallback) & Invariant 7 (Loop Prevention)
 *
 * Transparently cascades through fallback models on upstream HTTP 429 (Rate Limit),
 * HTTP 503 (Overloaded), network timeouts, or engine crashes.
 */

export class ModelFailoverGateway {
  constructor(options = {}) {
    this.cascade = options.cascade || [
      { provider: 'gemini', model: 'gemini-2.5-flash', timeoutMs: 15000 },
      { provider: 'openrouter', model: 'anthropic/claude-3.5-sonnet', timeoutMs: 20000 },
      { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct', timeoutMs: 25000 }
    ];
    this.geminiApiKey = options.geminiApiKey || process.env.GEMINI_API_KEY || '';
    this.openrouterApiKey = options.openrouterApiKey || process.env.OPENROUTER_API_KEY || '';
    this.customFetch = options.fetch || globalThis.fetch;
  }

  async executeWithFailover(messages, tools = [], options = {}) {
    let lastError = null;
    const attempts = [];

    for (const target of this.cascade) {
      const apiKey = target.provider === 'gemini' ? this.geminiApiKey : this.openrouterApiKey;
      if (!apiKey) {
        attempts.push({ target: target.model, provider: target.provider, skipped: true, reason: 'missing_api_key' });
        continue;
      }

      try {
        const startTime = Date.now();
        const response = await this._callProvider(target, messages, tools, apiKey, options);
        return {
          ...response,
          attempts: [...attempts, { target: target.model, provider: target.provider, ok: true, durationMs: Date.now() - startTime }]
        };
      } catch (err) {
        lastError = err;
        attempts.push({ target: target.model, provider: target.provider, ok: false, error: err.message, status: err.status });

        // Non-retryable authorization errors (e.g. 401 Unauthorized, invalid key) must abort cascade
        if (err.status === 401) {
          throw err;
        }
      }
    }

    const failure = new Error(`All failover model targets exhausted: ${lastError?.message || 'no response'}`);
    failure.attempts = attempts;
    failure.lastError = lastError;
    throw failure;
  }

  async _callProvider(target, messages, tools, apiKey, options = {}) {
    const url = target.provider === 'gemini'
      ? `https://generativelanguage.googleapis.com/v1beta/models/${target.model}:generateContent?key=${apiKey}`
      : 'https://openrouter.ai/api/v1/chat/completions';

    const headers = { 'Content-Type': 'application/json' };
    if (target.provider === 'openrouter') {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const body = target.provider === 'gemini'
      ? this._toGeminiPayload(messages, tools)
      : this._toOpenAIPayload(target.model, messages, tools);

    const res = await this.customFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs || target.timeoutMs || 15000)
    });

    if (!res.ok) {
      const errorText = await res.text();
      const err = new Error(`Upstream ${target.provider} error: ${res.status} - ${errorText}`);
      err.status = res.status;
      throw err;
    }
    return this._normalizeResponse(target.provider, await res.json());
  }

  _toGeminiPayload(messages, tools) {
    return {
      contents: messages.map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content || '' }]
      })),
      tools: tools?.length ? [{ functionDeclarations: tools.map(t => t.schema || t) }] : undefined
    };
  }

  _toOpenAIPayload(model, messages, tools) {
    return {
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content || '' })),
      tools: tools?.length ? tools.map(t => ({ type: 'function', function: t.schema || t })) : undefined
    };
  }

  _normalizeResponse(provider, json) {
    if (provider === 'gemini') {
      const candidate = json.candidates?.[0]?.content?.parts?.[0] || {};
      return {
        content: candidate.text || null,
        toolCalls: candidate.functionCall
          ? [{ name: candidate.functionCall.name, args: candidate.functionCall.args }]
          : [],
        providerUsed: 'gemini'
      };
    }
    const choice = json.choices?.[0]?.message || {};
    let toolCalls = [];
    if (Array.isArray(choice.tool_calls)) {
      toolCalls = choice.tool_calls.map(tc => ({
        name: tc.function?.name,
        args: typeof tc.function?.arguments === 'string'
          ? JSON.parse(tc.function.arguments)
          : (tc.function?.arguments || {})
      }));
    }
    return {
      content: choice.content || null,
      toolCalls,
      providerUsed: 'openrouter'
    };
  }
}
