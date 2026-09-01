import fs from 'fs';
import path from 'path';

const WEB_NODE_MODULES = '/root/.dsh/profiles/web/node_modules';

const TRANSLATIONS = [
  // dsh-persona-memory
  {
    file: path.join(WEB_NODE_MODULES, 'dsh-persona-memory/client/client.js'),
    replacements: [
      { from: /'记忆管理'/g, to: "'Persona Memory'" },
      { from: /"记忆管理"/g, to: '"Persona Memory"' }
    ]
  },
  {
    file: path.join(WEB_NODE_MODULES, 'dsh-persona-memory/dist/index.js'),
    replacements: [
      { from: /'记忆管理'/g, to: "'Persona Memory'" },
      { from: /"记忆管理"/g, to: '"Persona Memory"' }
    ]
  },
  // dsh-mnemon
  {
    file: path.join(WEB_NODE_MODULES, 'dsh-mnemon/lib/client.js'),
    replacements: [
      { from: /'记忆系统'/g, to: "'Memory System'" },
      { from: /"记忆系统"/g, to: '"Memory System"' },
      { from: /'记忆体'/g, to: "'Memory Spaces'" },
      { from: /"记忆体"/g, to: '"Memory Spaces"' },
      { from: /'决策'/g, to: "'Decisions'" },
      { from: /"决策"/g, to: '"Decisions"' },
      { from: /'偏好'/g, to: "'Preferences'" },
      { from: /"偏好"/g, to: '"Preferences"' },
      { from: /'事实'/g, to: "'Facts'" },
      { from: /"事实"/g, to: '"Facts"' },
      { from: /'洞察'/g, to: "'Insights'" },
      { from: /"洞察"/g, to: '"Insights"' }
    ]
  }
];

let modifiedCount = 0;
for (const entry of TRANSLATIONS) {
  if (fs.existsSync(entry.file)) {
    let content = fs.readFileSync(entry.file, 'utf8');
    let changed = false;
    for (const r of entry.replacements) {
      if (r.from.test(content)) {
        content = content.replace(r.from, r.to);
        changed = true;
      }
    }
    if (changed) {
      fs.writeFileSync(entry.file, content, 'utf8');
      console.log(`✅ English translation patched: ${path.basename(entry.file)} in ${path.dirname(entry.file).split('/').slice(-2).join('/')}`);
      modifiedCount++;
    }
  }
}

console.log(`\n🌐 Translation Patch Complete: ${modifiedCount} plugin bundle(s) translated to English.`);
