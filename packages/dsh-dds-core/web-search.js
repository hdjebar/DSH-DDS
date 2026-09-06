/**
 * @dsh-dds/core — Resilient Web Search Fallback Engine
 *
 * Ensures web searches never fail with "Every engine for the web source failed"
 * when third-party keyless quotas are exhausted or anonymous IP access is blocked.
 */

import https from 'node:https';

export function parseDuckDuckGoHtml(html, maxResults = 5) {
  const results = [];
  const regex = /<h2 class="result__title">[\s\S]*?<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = regex.exec(html)) !== null && results.length < maxResults) {
    let rawUrl = m[1];
    const uddg = rawUrl.match(/uddg=([^&]+)/);
    if (uddg) rawUrl = decodeURIComponent(uddg[1]);
    const title = m[2].replace(/<[^>]+>/g, '').trim();
    const snippet = m[3].replace(/<[^>]+>/g, '').trim();
    if (title && rawUrl) {
      results.push({ title, url: rawUrl, snippet });
    }
  }
  return results;
}

export function executeDuckDuckGoSearch(query, maxResults = 5, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        timeout: timeoutMs
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          return reject(new Error(`DuckDuckGo returned HTTP ${res.statusCode}`));
        }
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = parseDuckDuckGoHtml(data, maxResults);
            resolve(parsed);
          } catch (e) {
            reject(e);
          }
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Search request timed out after ${timeoutMs}ms`));
    });
  });
}

export async function resilientSearch(request, signal) {
  const query = request?.query || '';
  const maxResults = typeof request?.maxResults === 'number' ? request.maxResults : 5;

  try {
    const items = await executeDuckDuckGoSearch(query, maxResults);
    if (items.length === 0) {
      return {
        content: `Web search for "${query}" completed without matching public results.`,
        sources: [],
        truncated: false
      };
    }

    const contentLines = [
      `Web search results for: "${query}"`,
      ...items.map((it, idx) => `[${idx + 1}] ${it.title}\n${it.snippet}\nSource: ${it.url}`)
    ];

    const sources = items.map((it) => ({
      title: it.title,
      url: it.url
    }));

    return {
      content: contentLines.join('\n\n'),
      sources,
      truncated: false
    };
  } catch (err) {
    return {
      content: `Web search for "${query}" could not complete: ${err.message}`,
      sources: [],
      truncated: false
    };
  }
}

export function registerWebSearchFallback(ctx) {
  const hookWeb = (webCtx) => {
    if (!webCtx?.web || typeof webCtx.web.search !== 'function') return;
    if (webCtx.web.__dds_wrapped) return;

    const originalSearch = webCtx.web.search.bind(webCtx.web);
    webCtx.web.search = async function(request, signal) {
      try {
        return await originalSearch(request, signal);
      } catch (err) {
        const msg = String(err?.message || err);
        const isEngineFailure = (
          msg.includes('modsearch failed') ||
          msg.includes('Every engine for the web source failed') ||
          msg.includes('firecrawl rejected') ||
          msg.includes('suspicious') ||
          msg.includes('rate-limited') ||
          msg.includes('403') ||
          msg.includes('unavailable')
        );

        if (isEngineFailure) {
          console.warn(`🌐 [@dsh-dds/core] Primary search engine unavailable (${err.message?.slice(0, 80)}...). Engaging resilient zero-key web search fallback.`);
          return await resilientSearch(request, signal);
        }
        throw err;
      }
    };
    webCtx.web.__dds_wrapped = true;
    console.log('🛡️  [@dsh-dds/core] Resilient Web Search Fallback Engine registered on ctx.web');
  };

  if (typeof ctx.inject === 'function') {
    ctx.inject(['web'], (webCtx) => hookWeb(webCtx));
  } else if (ctx.web) {
    hookWeb(ctx);
  }
}
