#!/usr/bin/env node

/**
 * Market restart loopback patch for dshmarket.
 *
 * Allows same-origin restart requests originating from Docker bridge/container
 * network gateways (172.16.0.0/12, 10.0.0.0/8, 192.168.0.0/16) in addition to 127.0.0.1,
 * eliminating "Restart failed: restart is limited to same-origin loopback requests"
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
    return false;
}
`;

const ipTarget = "if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1')\n        return false;";
const ipReplacement = "if (!isTrustedClientIp(address))\n        return false;";

const termTarget = "setTimeout(() => process.kill(process.pid, 'SIGTERM'), 500);";
const termReplacement = "setTimeout(() => { try { process.kill(process.pid, 'SIGTERM'); } catch {} setTimeout(() => process.exit(0), 1000); }, 500);";

for (const file of targetFiles) {
  if (!fs.existsSync(file)) continue;
  const real = fs.realpathSync(file);
  let content = fs.readFileSync(real, 'utf8');

  if (content.includes('function isTrustedClientIp')) {
    console.log(`ℹ️ dshmarket restart already patched in ${real}; skipping.`);
    continue;
  }

  if (!content.includes(ipTarget)) {
    console.warn(`⚠️ ipTarget missing in ${real}`);
    continue;
  }

  content = helperFn + content.replaceAll(ipTarget, ipReplacement);
  if (content.includes(termTarget)) {
    content = content.replace(termTarget, termReplacement);
  }

  fs.writeFileSync(real, content, 'utf8');
  console.log(`✅ Patched dshmarket restart in ${real}`);
}
