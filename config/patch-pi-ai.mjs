import fs from 'fs';

const file = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js';

if (fs.existsSync(file)) {
  let content = fs.readFileSync(file, 'utf8');
  
  if (!content.includes('const googleExtraContentCache')) {
    content = 'const googleExtraContentCache = new Map();\n' + content;
    
    // 1. Capture extra_content in stream
    const t1 = 'const name = toolCall.function?.name ?? toolCall.custom?.name;';
    const r1 = 'if (toolCall.extra_content) {\n                                block.extra_content = toolCall.extra_content;\n                                if (toolCall.id || block.id) {\n                                    googleExtraContentCache.set(toolCall.id || block.id, toolCall.extra_content);\n                                }\n                            }\n                            const name = toolCall.function?.name ?? toolCall.custom?.name;';
    
    // 2. Attach extra_content in outbound requests
    const t2 = 'return {\n                        id: tc.id,';
    const r2 = 'const extra = tc.extra_content || googleExtraContentCache.get(tc.id);\n                    return {\n                        ...(extra ? { extra_content: extra } : {}),\n                        id: tc.id,';
    
    content = content.replace(t1, r1).replace(t2, r2);
    fs.writeFileSync(file, content, 'utf8');
    console.log('✅ Applied Google thought_signature bridge patch cleanly.');
  }
}
