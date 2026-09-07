import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelFailoverGateway } from '../config/failover-gateway.mjs';

test('ModelFailoverGateway: returns successful response on primary model', async () => {
  const mockFetch = async (url) => {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{
          content: { parts: [{ text: 'Hello from Gemini!' }] }
        }]
      })
    };
  };

  const gateway = new ModelFailoverGateway({
    cascade: [
      { provider: 'gemini', model: 'gemini-2.5-flash' },
      { provider: 'openrouter', model: 'anthropic/claude-3.5-sonnet' }
    ],
    geminiApiKey: 'mock-gemini-key',
    openrouterApiKey: 'mock-or-key',
    fetch: mockFetch
  });

  const res = await gateway.executeWithFailover([{ role: 'user', content: 'hello' }]);
  assert.equal(res.content, 'Hello from Gemini!');
  assert.equal(res.providerUsed, 'gemini');
  assert.equal(res.attempts.length, 1);
  assert.equal(res.attempts[0].ok, true);
});

test('ModelFailoverGateway: cascades to secondary provider on HTTP 429 rate-limit', async () => {
  let callCount = 0;
  const mockFetch = async (url) => {
    callCount++;
    if (url.includes('googleapis.com')) {
      return {
        ok: false,
        status: 429,
        text: async () => 'RESOURCE_EXHAUSTED: Quota exceeded'
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: 'Hello from Claude fallback!',
            tool_calls: [{
              function: { name: 'search', arguments: '{"q":"news"}' }
            }]
          }
        }]
      })
    };
  };

  const gateway = new ModelFailoverGateway({
    cascade: [
      { provider: 'gemini', model: 'gemini-2.5-flash' },
      { provider: 'openrouter', model: 'anthropic/claude-3.5-sonnet' }
    ],
    geminiApiKey: 'mock-gemini-key',
    openrouterApiKey: 'mock-or-key',
    fetch: mockFetch
  });

  const res = await gateway.executeWithFailover([{ role: 'user', content: 'test rate limit' }]);
  assert.equal(callCount, 2);
  assert.equal(res.content, 'Hello from Claude fallback!');
  assert.equal(res.providerUsed, 'openrouter');
  assert.equal(res.toolCalls.length, 1);
  assert.equal(res.toolCalls[0].name, 'search');
  assert.deepEqual(res.toolCalls[0].args, { q: 'news' });
  assert.equal(res.attempts[0].ok, false);
  assert.equal(res.attempts[0].status, 429);
  assert.equal(res.attempts[1].ok, true);
});

test('ModelFailoverGateway: aborts immediately on HTTP 401 Unauthorized without cascade', async () => {
  let callCount = 0;
  const mockFetch = async () => {
    callCount++;
    return {
      ok: false,
      status: 401,
      text: async () => 'UNAUTHENTICATED: Invalid API Key'
    };
  };

  const gateway = new ModelFailoverGateway({
    cascade: [
      { provider: 'gemini', model: 'gemini-2.5-flash' },
      { provider: 'openrouter', model: 'anthropic/claude-3.5-sonnet' }
    ],
    geminiApiKey: 'mock-gemini-key',
    openrouterApiKey: 'mock-or-key',
    fetch: mockFetch
  });

  await assert.rejects(
    async () => gateway.executeWithFailover([{ role: 'user', content: 'auth test' }]),
    (err) => {
      assert.equal(err.status, 401);
      return true;
    }
  );
  assert.equal(callCount, 1, 'Cascade must not proceed after an explicit 401 error');
});

test('ModelFailoverGateway: throws comprehensive error when all model targets fail', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 503,
    text: async () => 'Service Unavailable'
  });

  const gateway = new ModelFailoverGateway({
    cascade: [
      { provider: 'gemini', model: 'gemini-2.5-flash' },
      { provider: 'openrouter', model: 'anthropic/claude-3.5-sonnet' }
    ],
    geminiApiKey: 'mock-gemini-key',
    openrouterApiKey: 'mock-or-key',
    fetch: mockFetch
  });

  await assert.rejects(
    async () => gateway.executeWithFailover([{ role: 'user', content: 'test all fail' }]),
    /All failover model targets exhausted/
  );
});
