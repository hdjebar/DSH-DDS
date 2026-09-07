/**
 * Network Trust & Gateway IP Verification Utility for @dsh-dds/core
 *
 * Extracted to avoid circular dependencies between iam.js and gateway.js.
 */

export function isTrustedGatewayIp(addr) {
  if (!addr || typeof addr !== 'string') return false;
  const ip = addr.replace(/^::ffff:/, '').trim();
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return true;
  if (/^10\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true;
  if (/^fe80:/i.test(ip)) return true;
  if (/^fd[0-9a-f]{2}:/i.test(ip)) return true;
  return false;
}

export function isLoopbackOrLocalBridgeIp(addr) {
  if (!addr || typeof addr !== 'string') return false;
  const ip = addr.replace(/^::ffff:/, '').trim();
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
  // Standard Docker bridge default 172.16.0.0/12
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return true;
  return false;
}
