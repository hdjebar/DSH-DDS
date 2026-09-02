import fs from 'fs';
import path from 'path';

const WEB_NODE_MODULES = '/root/.dsh/profiles/web/node_modules';

const TRANSLATIONS = [
  // 1. dsh-mnemon
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
  },
  // 3. dshmarket (Visual Plugin Market)
  {
    file: path.join(WEB_NODE_MODULES, 'dshmarket/client/client.js'),
    replacements: [
      { from: /"插件市场"/g, to: '"Plugin Market"' },
      { from: /'插件市场'/g, to: "'Plugin Market'" },
      { from: /"查看插件市场版本与设置"/g, to: '"Plugin Market Settings"' },
      { from: /"搜索插件"/g, to: '"Search plugins..."' },
      { from: /'搜索插件'/g, to: "'Search plugins...'" },
      { from: /"发现"/g, to: '"Discover"' },
      { from: /'发现'/g, to: "'Discover'" },
      { from: /"已安装"/g, to: '"Installed"' },
      { from: /'已安装'/g, to: "'Installed'" },
      { from: /"全部"/g, to: '"All"' },
      { from: /'全部'/g, to: "'All'" },
      { from: /"高级"/g, to: '"Advanced"' },
      { from: /'高级'/g, to: "'Advanced'" },
      { from: /"安装"/g, to: '"Install"' },
      { from: /'安装'/g, to: "'Install'" },
      { from: /"安装中"/g, to: '"Installing..."' },
      { from: /"卸载"/g, to: '"Uninstall"' },
      { from: /'卸载'/g, to: "'Uninstall'" },
      { from: /"卸载中"/g, to: '"Uninstalling..."' },
      { from: /"已是最新版本"/g, to: '"Up to date"' },
      { from: /"有新版本"/g, to: '"Update available"' },
      { from: /"更新"/g, to: '"Update"' },
      { from: /'更新'/g, to: "'Update'" },
      { from: /"重启"/g, to: '"Restart"' },
      { from: /'重启'/g, to: "'Restart'" },
      { from: /"取消"/g, to: '"Cancel"' },
      { from: /"确认卸载"/g, to: '"Confirm Uninstall"' },
      { from: /"没有匹配的插件"/g, to: '"No matching plugins found"' },
      { from: /"尚未安装社区插件"/g, to: '"No community plugins installed yet"' }
    ]
  },
  {
    file: path.join(WEB_NODE_MODULES, 'dshmarket/lib/index.js'),
    replacements: [
      { from: /'插件市场'/g, to: "'Plugin Market'" },
      { from: /"插件市场"/g, to: '"Plugin Market"' }
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
