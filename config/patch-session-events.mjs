#!/usr/bin/env node

/**
 * Session events iterable patch for @deepseek-ai/dsh-session and dsh-mnemon.
 *
 * Ensures session.events is an iterable Array via a prototype getter returning
 * snapshotEvents(), preventing "agent.session.events is not iterable" runtime errors
 * in dsh-mnemon and dsh-session-reader.
 */

import fs from 'fs';

const sessionFiles = process.env.DSH_SESSION_FILE
  ? [process.env.DSH_SESSION_FILE]
  : [
      '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session/lib/index.js',
      '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session/lib/types/index.js'
    ];

for (const file of sessionFiles) {
  if (!fs.existsSync(file)) continue;
  const real = fs.realpathSync(file);
  let content = fs.readFileSync(real, 'utf8');
  if (content.includes('get events()')) {
    console.log(`ℹ️ Session.prototype.events already patched in ${real}; skipping.`);
    continue;
  }
  const anchor = 'ownEvents() {';
  if (!content.includes(anchor)) {
    console.warn(`⚠️ Anchor 'ownEvents() {' missing in ${real}`);
    continue;
  }
  const replacement = `get events() {\n\t\treturn this.snapshotEvents();\n\t}\n\townEvents() {`;
  content = content.replace(anchor, replacement);
  fs.writeFileSync(real, content, 'utf8');
  console.log(`✅ Patched Session.prototype.events in ${real}`);
}

const mnemonFiles = process.env.DSH_MNEMON_FILE
  ? [process.env.DSH_MNEMON_FILE]
  : [
      '/app/prebuilt-profiles/web/node_modules/dsh-mnemon/lib/index.js',
      '/root/.dsh/profiles/web/node_modules/dsh-mnemon/lib/index.js'
    ];

for (const file of mnemonFiles) {
  if (!fs.existsSync(file)) continue;
  const real = fs.realpathSync(file);
  let content = fs.readFileSync(real, 'utf8');
  const target = 'for (const event of agent.session.events)';
  if (content.includes(target)) {
    const replacement = 'for (const event of (agent?.session?.events ?? agent?.session?.snapshotEvents?.() ?? []))';
    content = content.replace(target, replacement);
    fs.writeFileSync(real, content, 'utf8');
    console.log(`✅ Patched safe openAgentTurn in ${real}`);
  }
}
