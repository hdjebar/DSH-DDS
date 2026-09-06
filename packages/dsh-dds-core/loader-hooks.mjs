/**
 * @dsh-dds/core — ESM Customization Loader Hooks
 *
 * Intercepts module loading in-memory to provide seamless backward and forward
 * compatibility across community plugins, LLM providers, and Cordis services
 * WITHOUT modifying any files in node_modules on disk.
 */

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (!result || !result.source) return result;

  let source = result.source.toString();
  let modified = false;

  // 1. @deepseek-ai/dsh-settings: Synthesize missing settingsNamespace export
  if (url.includes('@deepseek-ai/dsh-settings') && !source.includes('settingsNamespace')) {
    source += '\nexport function settingsNamespace(v) { return v; };\n';
    modified = true;
  }

  // 2. dsh-model-sync: Replace unexported settingsNamespace re-export
  if (url.includes('dsh-model-sync') && source.includes("export { settingsNamespace } from '@deepseek-ai/dsh-settings';")) {
    source = source.replace(
      "export { settingsNamespace } from '@deepseek-ai/dsh-settings';",
      "export function settingsNamespace(v) { return v; };"
    );
    modified = true;
  }

  // 3. @deepseek-ai/dsh-settings-file: Safe path redirect to writable storages
  if (url.includes('@deepseek-ai/dsh-settings-file')) {
    const target = 'const filename = resolve(config.path ?? join(resolveDshHome(config.dshHome), "settings.yaml"));';
    const repl = 'const filename = resolve(config.path ?? process.env.DSH_SETTINGS_FILE ?? join(resolveDshHome(config.dshHome), "storages", "settings.yaml"));';
    if (source.includes(target)) {
      source = source.replace(target, repl);
      modified = true;
    }
  }

  // 4. @deepseek-ai/dsh-session: Ensure Session.prototype.events is an iterable accessor
  if (url.includes('@deepseek-ai/dsh-session') && source.includes('ownEvents() {') && !source.includes('get events()')) {
    source = source.replace(
      'ownEvents() {',
      'get events() { return typeof this.snapshotEvents === "function" ? this.snapshotEvents() : []; }\nownEvents() {'
    );
    modified = true;
  }

  // 5. dsh-mnemon: Ensure safe fallback when accessing agent.session.events
  if (url.includes('dsh-mnemon') && source.includes('for (const event of agent.session.events)')) {
    source = source.replace(
      'for (const event of agent.session.events)',
      'for (const event of (agent?.session?.events ?? agent?.session?.snapshotEvents?.() ?? []))'
    );
    modified = true;
  }

  // 6. @earendil-works/pi-ai: Remove bogus 400 (no body) from context overflow patterns
  // Prevents false CONTEXT_WINDOW_EXCEEDED compaction loop on Google Gemini & OpenAI protocol errors
  if (url.includes('@earendil-works/pi-ai') && url.includes('overflow.js')) {
    const targetRegex = '/^4(?:00|13)\\s*(?:status code)?\\s*\\(no body\\)/i,';
    if (source.includes(targetRegex)) {
      source = source.replace(targetRegex, '/* 400 status code (no body) removed: handled by semantic gateway */');
      modified = true;
    }
  }

  // 7. @earendil-works/pi-ai: Thought signature preservation in openai-completions.js
  if (url.includes('@earendil-works/pi-ai') && url.includes('openai-completions.js') && !source.includes('googleExtraContentCache')) {
    const ANCHOR_CAPTURE = 'const name = toolCall.function?.name ?? toolCall.custom?.name;';
    const ANCHOR_EMIT = 'return {\n                        id: tc.id,';
    if (source.includes(ANCHOR_CAPTURE)) {
      const capture = [
        'if (toolCall.extra_content) {',
        '                                block.extra_content = toolCall.extra_content;',
        '                                if (toolCall.id || block.id) {',
        '                                    googleExtraContentCache.set(toolCall.id || block.id, toolCall.extra_content);',
        '                                }',
        '                            }',
        '                            ' + ANCHOR_CAPTURE
      ].join('\n');
      const emit = [
        'const extra = tc.extra_content || googleExtraContentCache.get(tc.id);',
        '                    return {',
        '                        ...(extra ? { extra_content: extra } : {}),',
        '                        id: tc.id,'
      ].join('\n');
      source = 'const googleExtraContentCache = new Map();\n' + source;
      source = source.replace(ANCHOR_CAPTURE, capture);
      if (source.includes(ANCHOR_EMIT)) {
        source = source.replace(ANCHOR_EMIT, emit);
      }
      modified = true;
    }
  }

  // 8. dsh-model-sync: Auto-append missing patch entries in cordis.patch.yml instead of throwing
  if (url.includes('dsh-model-sync') && source.includes('patch entry not found:')) {
    const errorThrow = "throw new Error(`patch entry not found: ${id}`);";
    const autoAppend = [
      "lines.push(`- id: ${id}`);",
      "if (!enabled) lines.push(`  disabled: true`);",
      "writeFileSync(path, `${lines.join('\\n').replace(/\\n+$/, '')}\\n`, 'utf8');",
      "return;"
    ].join('\n    ');
    if (source.includes(errorThrow)) {
      source = source.replace(errorThrow, autoAppend);
      modified = true;
    }
  }

  // 9. @deepseek-ai/dsh-client-modules: Auto-alias community plugin bundle registrations in-memory
  // If a community plugin (e.g. @all3cn/dsh-better-sidebar-n23) calls __ModuleLoader__.load with a
  // legacy or un-scoped ID (e.g. "dsh-better-sidebar"), auto-register both the alias and the package name.
  if (url.includes('@deepseek-ai/dsh-client-modules') && source.includes('initialBundleSnapshot(pkgName, clientPath) {')) {
    const targetSnapshot = 'const bundle = readFileSync(clientPath);';
    const aliasShim = [
      'let bundle = readFileSync(clientPath);',
      'try {',
      '  const _str = bundle.toString("utf8");',
      '  const _m = _str.match(/window\\.__ModuleLoader__\\.load\\s*\\(\\s*\\{\\s*id:\\s*["\']([^"\']+)["\']/);',
      '  if (_m && _m[1] && pkgName && _m[1] !== pkgName) {',
      '    const _preamble = Buffer.from(`(()=>{const _l=window.__ModuleLoader__.load;window.__ModuleLoader__.load=function(r){_l.call(window.__ModuleLoader__,r);try{_l.call(window.__ModuleLoader__,Object.assign({},r,{id:${JSON.stringify(pkgName)}}));}catch(e){}};})();\\n`, "utf8");',
      '    bundle = Buffer.concat([_preamble, bundle]);',
      '  }',
      '} catch (e) {}'
    ].join('\n    ');
    if (source.includes(targetSnapshot)) {
      source = source.replace(targetSnapshot, aliasShim);
      modified = true;
    }
  }
  if (url.includes('@deepseek-ai/dsh-client-modules') && source.includes('!this.factories.has(id)) throw new Error(`client-modules: bundle')) {
    source = source.replace(
      'if (!this.factories.has(id)) throw new Error(`client-modules: bundle',
      'if (!this.factories.has(id)) { const _b = id.replace(/^@[^/]+\\//, ""); const _c = Array.from(this.factories.keys()).find(k => k === _b || k === _b.replace(/-n\\d+$/, "") || _b === k.replace(/-n\\d+$/, "")); if (_c) this.factories.set(id, this.factories.get(_c)); } if (!this.factories.has(id)) throw new Error(`client-modules: bundle'
    );
    modified = true;
  }

  return modified ? { ...result, source } : result;
}

