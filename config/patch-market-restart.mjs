#!/usr/bin/env node

/**
 * Market restart loopback patch for dshmarket.
 *
 * Allows same-origin restart requests originating from Docker bridge/container
 * network gateways (172.16.0.0/12, 10.0.0.0/8, 192.168.0.0/16, 169.254.0.0/16, IPv6 ULA/LL)
 * in addition to 127.0.0.1, eliminating "Restart failed: restart is limited to same-origin loopback requests"
 * when accessed via Web Workbench host port mapping.
 */

import fs from 'fs';

const targetFiles = process.env.DSH_MARKET_RESTART_FILE
  ? [process.env.DSH_MARKET_RESTART_FILE]
  : [
      '/app/prebuilt-profiles/web/node_modules/dshmarket/lib/restart.js',
      '/root/.dsh/profiles/web/node_modules/dshmarket/lib/restart.js'
    ];

const helperFn = `function isTrustedClientIp(addr) {
    if (!addr) return false;
    const ip = addr.replace(/^::ffff:/, '');
    if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
    if (/^172\\.(1[6-9]|2[0-9]|3[0-1])\\./.test(ip)) return true;
    if (/^10\\./.test(ip)) return true;
    if (/^192\\.168\\./.test(ip)) return true;
    if (/^169\\.254\\./.test(ip)) return true;
    if (/^fe80:/i.test(ip)) return true;
    if (/^fd[0-9a-f]{2}:/i.test(ip)) return true;
    return false;
}

function isSameOriginOrLoopback(originStr, hostStr) {
    if (!hostStr || !originStr) return false;
    try {
        const parsed = new URL(originStr);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
        if (parsed.host === hostStr) return true;
        const oHost = parsed.hostname;
        const [hHost, hPort] = hostStr.split(':');
        const oPort = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
        const effectiveHPort = hPort || (parsed.protocol === 'https:' ? '443' : '80');
        if (oPort !== effectiveHPort) return false;
        const isLocalO = oHost === 'localhost' || oHost === '127.0.0.1' || isTrustedClientIp(oHost);
        const isLocalH = hHost === 'localhost' || hHost === '127.0.0.1' || hHost === '0.0.0.0' || isTrustedClientIp(hHost);
        return isLocalO && isLocalH;
    } catch {
        return false;
    }
}
`;

const termTarget = "setTimeout(() => process.kill(process.pid, 'SIGTERM'), 500);";
const termReplacement = "setTimeout(() => { try { process.kill(process.pid, 'SIGTERM'); } catch {} setTimeout(() => process.exit(0), 1000); }, 500);";

for (const file of targetFiles) {
  if (!fs.existsSync(file)) continue;
  const real = fs.realpathSync(file);
  let content = fs.readFileSync(real, 'utf8');

  let modified = false;

  // 1. Inject helper functions if missing or upgrade
  if (!content.includes('function isTrustedClientIp')) {
    content = helperFn + content;
    modified = true;
  } else if (!content.includes('function isSameOriginOrLoopback')) {
    content = content.replace('function isTrustedClientIp', helperFn.trim() + '\n\n// old\nfunction isTrustedClientIp_old');
    content = content.replace(/function isTrustedClientIp_old[\s\S]*?return false;\s*\}/, '');
    modified = true;
  }

  // 2. Replace IP checks
  const ipTarget = "if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1')\n        return false;";
  const ipReplacement = "if (!isTrustedClientIp(address))\n        return false;";
  if (content.includes(ipTarget)) {
    content = content.replaceAll(ipTarget, ipReplacement);
    modified = true;
  }

  // 3. Relax origin and host check in trustedRestartRequest if present
  const originTarget = "if (origin === undefined || host === undefined)\n        return false;\n    try {\n        const parsed = new URL(origin);\n        return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === host;\n    }\n    catch {\n        return false;\n    }";
  const originReplacement = "const effectiveOrigin = origin || (request.headers.referer ? new URL(request.headers.referer).origin : undefined);\n    if (!effectiveOrigin || !host)\n        return false;\n    return isSameOriginOrLoopback(effectiveOrigin, host);";
  if (content.includes(originTarget)) {
    content = content.replace(originTarget, originReplacement);
    modified = true;
  }

  // 4. Update SIGTERM to graceful exit
  if (content.includes(termTarget)) {
    content = content.replace(termTarget, termReplacement);
    modified = true;
  }

  if (modified) {
    fs.writeFileSync(real, content, 'utf8');
    console.log(`✅ Patched dshmarket restart in ${real}`);
  } else {
    console.log(`ℹ️ dshmarket restart already patched in ${real}; skipping.`);
  }
}
