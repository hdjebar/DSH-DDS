#!/usr/bin/env node

/**
 * Google AI Studio thought_signature bridge for @earendil-works/pi-ai.
 *
 * The Dockerfile applies this same patch inline at build time. This standalone copy
 * exists to repair a running container or a host-side install. Both must stay in sync:
 * missing anchors are a hard error, never a silent no-op, so an upstream pi-ai change
 * surfaces immediately instead of degrading Gemini tool calling at runtime.
 */

import fs from 'fs';

const FILE = process.env.PI_AI_COMPLETIONS_FILE
  || '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js';

const ANCHOR_CAPTURE = 'const name = toolCall.function?.name ?? toolCall.custom?.name;';
const ANCHOR_EMIT = 'return {\n                        id: tc.id,';

if (!fs.existsSync(FILE)) {
  console.error(`❌ pi-ai completions module not found at ${FILE}`);
  process.exit(1);
}

let content = fs.readFileSync(FILE, 'utf8');

if (content.includes('googleExtraContentCache')) {
  console.log('ℹ️ pi-ai thought signature bridge already applied; nothing to do.');
  process.exit(0);
}

if (!content.includes(ANCHOR_CAPTURE)) {
  console.error('❌ pi-ai anchor1 missing — upstream module changed, patch not applied.');
  process.exit(1);
}
if (!content.includes(ANCHOR_EMIT)) {
  console.error('❌ pi-ai anchor2 missing — upstream module changed, patch not applied.');
  process.exit(1);
}

// 1. Capture extra_content as tool calls stream in.
const capture = 'if (toolCall.extra_content) {\n'
  + '                                block.extra_content = toolCall.extra_content;\n'
  + '                                if (toolCall.id || block.id) {\n'
  + '                                    googleExtraContentCache.set(toolCall.id || block.id, toolCall.extra_content);\n'
  + '                                }\n'
  + '                            }\n'
  + '                            ' + ANCHOR_CAPTURE;

// 2. Replay extra_content on outbound requests.
const emit = 'const extra = tc.extra_content || googleExtraContentCache.get(tc.id);\n'
  + '                    return {\n'
  + '                        ...(extra ? { extra_content: extra } : {}),\n'
  + '                        id: tc.id,';

content = 'const googleExtraContentCache = new Map();\n' + content;
content = content.replace(ANCHOR_CAPTURE, capture).replace(ANCHOR_EMIT, emit);

fs.writeFileSync(FILE, content, 'utf8');
console.log('✅ Applied Google thought_signature bridge patch cleanly.');
