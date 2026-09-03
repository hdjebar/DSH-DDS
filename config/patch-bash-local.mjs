#!/usr/bin/env node

/**
 * Auto-workdir creation patch for @deepseek-ai/dsh-bash-local under Landlock sandbox.
 */

import fs from 'fs';

const FILE = process.env.DSH_BASH_LOCAL_FILE
  || '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-bash-local/lib/index.js';

if (!fs.existsSync(FILE)) {
  console.log(`ℹ️ dsh-bash-local module not found at ${FILE}; skipping.`);
  process.exit(0);
}

let content = fs.readFileSync(FILE, 'utf8');

if (content.includes('mkdirSync(spec.workdir')) {
  console.log('ℹ️ dsh-bash-local auto-workdir patch already applied; nothing to do.');
  process.exit(0);
}

const anchor = 'function spawnSpec(spec, argv, stdoutMaxBytes, signal) {';
if (!content.includes(anchor)) {
  console.error('❌ dsh-bash-local spawnSpec anchor missing — upstream module changed.');
  process.exit(1);
}

content = 'import fs from "node:fs";\n' + content;
content = content.replace(
  anchor,
  'function spawnSpec(spec, argv, stdoutMaxBytes, signal) {\n\t\tif (spec.workdir && !fs.existsSync(spec.workdir)) { try { fs.mkdirSync(spec.workdir, { recursive: true }); } catch {} }'
);

fs.writeFileSync(FILE, content, 'utf8');
console.log('✅ dsh-bash-local auto-workdir patch applied cleanly.');
