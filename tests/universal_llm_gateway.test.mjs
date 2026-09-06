import test from 'node:test';
import assert from 'node:assert/strict';
import { LlmSemanticGateway } from '../packages/dsh-dds-core/llm-gateway.js';

test('Universal LLM Gateway: captures and re-injects thought signatures across turns', () => {
  const mockCtx = { inject: () => {} };
  const gateway = new LlmSemanticGateway(mockCtx);

  // Simulate incoming tool call chunk with extra_content from Google Gemini
  const incomingChunk = {
    type: 'tool-call',
    tool_call: {
      id: 'call_gemini_123',
      name: 'execute_command',
      extra_content: { google: { thought_signature: 'sig_abc_xyz' } }
    }
  };

  gateway.captureThoughtSignatures(incomingChunk);
  assert.equal(gateway.thoughtSignatures.get('call_gemini_123'), incomingChunk.tool_call.extra_content);

  // Subsequent turn: agent formats tool results but omitted extra_content
  const subsequentOptions = {
    model: 'gemini-2.5-pro',
    messages: [
      {
        role: 'assistant',
        tool_calls: [
          {
            id: 'call_gemini_123',
            name: 'execute_command'
          }
        ]
      },
      {
        role: 'tool',
        tool_call_id: 'call_gemini_123',
        content: 'command output'
      }
    ]
  };

  const normalized = gateway.normalizeRequestOptions(subsequentOptions);
  assert.ok(normalized.messages[0].tool_calls[0].extra_content, 'Thought signature must be re-injected');
  assert.equal(normalized.messages[0].tool_calls[0].extra_content.google.thought_signature, 'sig_abc_xyz');
});

test('Universal LLM Gateway: sanitizes reasoning model parameters', () => {
  const mockCtx = { inject: () => {} };
  const gateway = new LlmSemanticGateway(mockCtx);

  const reasoningOptions = {
    model: 'o3-mini',
    temperature: 0.7, // Unsupported on o-series reasoning models
    messages: [{ role: 'user', content: 'solve this' }]
  };

  const normalized = gateway.normalizeRequestOptions(reasoningOptions);
  assert.equal(normalized.temperature, undefined, 'temperature parameter must be stripped for reasoning models');
  assert.equal(normalized.model, 'o3-mini');
});

test('Universal LLM Gateway: anti-compaction circuit breaker overrides bogus 400 context overflow', async () => {
  const mockCtx = { inject: () => {} };
  const gateway = new LlmSemanticGateway(mockCtx);

  const mockProto = {
    adapterStream: async function*(options) {
      // Simulate pi-ai error chunk
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: {
            code: 'CONTEXT_WINDOW_EXCEEDED',
            message: '400 status code (no body)'
          }
        }
      };
    }
  };

  gateway.decorateLlmRuntime(mockProto);

  const stream = mockProto.adapterStream({
    model: 'gemini-2.5-flash',
    messages: [{ role: 'user', content: 'hello' }]
  });

  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  assert.equal(chunks.length, 1);
  const failure = chunks[0].reason.failure;
  assert.equal(failure.code, 'PROVIDER_PROTOCOL_ERROR', 'Must override false CONTEXT_WINDOW_EXCEEDED');
  assert.ok(failure.message.includes('HTTP 400 Bad Request'), 'Must identify true cause as HTTP 400 rather than context overflow');
});
