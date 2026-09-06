/**
 * UI Localization Tap for @dsh-dds/core
 *
 * Uses native Cordis ctx.webServer.tapIndex(html => ...) to inject runtime
 * English translations and DOM observers instead of running regex scripts
 * over minified client bundles on disk.
 */

export const TRANSLATION_DICTIONARY = {
  // Mnemon / Memory System
  '记忆系统': 'Memory System',
  '记忆体': 'Memory Spaces',
  '决策': 'Decisions',
  '偏好': 'Preferences',
  '事实': 'Facts',
  '洞察': 'Insights',

  // dshmarket / Plugin Market
  '插件市场': 'Plugin Market',
  '查看插件市场版本与设置': 'Plugin Market Settings',
  '搜索插件': 'Search plugins...',
  '发现': 'Discover',
  '已安装': 'Installed',
  '全部': 'All',
  '高级': 'Advanced',
  '安装': 'Install',
  '安装中': 'Installing...',
  '卸载': 'Uninstall',
  '卸载中': 'Uninstalling...',
  '已是最新版本': 'Up to date',
  '有新版本': 'Update available',
  '更新': 'Update',
  '重启': 'Restart',
  '取消': 'Cancel',
  '确认卸载': 'Confirm Uninstall',
  '没有匹配的插件': 'No matching plugins found',
  '尚未安装社区插件': 'No community plugins installed yet',

  // Workbench & Core UI
  '会话': 'Sessions',
  '新建会话': 'New Session',
  '工作区': 'Workspace',
  '设置': 'Settings',
  '模型': 'Models',
  '角色': 'Personas',
  '技能': 'Skills',
  '工具': 'Tools',
  '知识库': 'Knowledge',
  '执行中': 'Executing...',
  '已完成': 'Completed',
  '失败': 'Failed'
};

export function registerLocalizationTap(ctx) {
  const webServer = ctx.webServer;
  if (!webServer || typeof webServer.tapIndex !== 'function') return;

  const clientScript = `
<script id="dsh-dds-i18n-tap">
(() => {
  const dict = ${JSON.stringify(TRANSLATION_DICTIONARY)};
  function translateText(text) {
    if (!text) return text;
    let out = text;
    for (const [zh, en] of Object.entries(dict)) {
      if (out.includes(zh)) out = out.replaceAll(zh, en);
    }
    return out;
  }
  function translateNode(node) {
    if (node.nodeType === 3) {
      if (node.nodeValue) {
        const next = translateText(node.nodeValue);
        if (next !== node.nodeValue) node.nodeValue = next;
      }
    } else if (node.nodeType === 1) {
      if (node.placeholder) {
        const next = translateText(node.placeholder);
        if (next !== node.placeholder) node.placeholder = next;
      }
      if (node.title) {
        const next = translateText(node.title);
        if (next !== node.title) node.title = next;
      }
      node.childNodes.forEach(translateNode);
    }
  }
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach(translateNode);
      if (m.type === 'characterData') translateNode(m.target);
    }
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      translateNode(document.body);
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    });
  } else {
    translateNode(document.body);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
})();
</script>
`;

  webServer.tapIndex((html) => {
    if (html.includes('id="dsh-dds-i18n-tap"')) return html;
    if (html.includes('</body>')) {
      return html.replace('</body>', `${clientScript}</body>`);
    }
    return html + clientScript;
  });
}
