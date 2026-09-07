/**
 * WebServer Gateway & Lifecycle Supervisor Adapter for @dsh-dds/core
 *
 * Replaces ad-hoc disk patches (patch-market-restart.mjs, patch-client-connection.mjs).
 * Native Cordis integration intercepting requests on ctx.webServer.
 */
import { handleVaultApiRequest, ByokVault } from './byok-vault.js';

export function isTrustedGatewayIp(addr) {
  if (!addr) return false;
  const ip = addr.replace(/^::ffff:/, '');
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return true;
  if (/^10\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true;
  if (/^fe80:/i.test(ip)) return true;
  if (/^fd[0-9a-f]{2}:/i.test(ip)) return true;
  return false;
}

export function isSameOriginOrLoopback(originStr, hostStr) {
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
    const isLocalO = oHost === 'localhost' || oHost === '127.0.0.1' || isTrustedGatewayIp(oHost);
    const isLocalH = hHost === 'localhost' || hHost === '127.0.0.1' || hHost === '0.0.0.0' || isTrustedGatewayIp(hHost);
    return isLocalO && isLocalH;
  } catch {
    return false;
  }
}

export function registerGatewayMiddleware(ctx, config = {}) {
  const webServer = ctx.webServer;
  if (!webServer || !webServer.server) return;

  // Intercept incoming requests before route resolution
  webServer.server.prependListener('request', (req, res) => {
    const remote = req.socket?.remoteAddress;

    // 1. If coming from Docker bridge or trusted gateway, normalize remoteAddress
    if (isTrustedGatewayIp(remote)) {
      req.__dshGatewayTrusted = true;
    }

    // 2. Fallback to Referer origin if Origin header is missing
    if (!req.headers.origin && req.headers.referer) {
      try {
        req.headers.origin = new URL(req.headers.referer).origin;
      } catch {}
    }

    // 3. Normalize localhost / 127.0.0.1 Host and Origin mismatch
    const host = req.headers.host;
    const origin = req.headers.origin;
    if (host && origin && isSameOriginOrLoopback(origin, host)) {
      // Align origin with host to satisfy strict same-origin loopback checks
      try {
        const parsed = new URL(origin);
        if (parsed.host !== host) {
          req.headers['x-forwarded-host'] = host;
        }
      } catch {}
    }
  });

  // Dedicated lifecycle restart endpoint
  webServer.register({
    kind: 'exact',
    path: '/dsh-dds/lifecycle/restart',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST.' }));
        return;
      }

      const remote = req.socket?.remoteAddress;
      const origin = req.headers.origin || (req.headers.referer ? new URL(req.headers.referer).origin : '');
      const host = req.headers.host || '';

      if (!isTrustedGatewayIp(remote) && !isSameOriginOrLoopback(origin, host)) {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Forbidden: Restart request must originate from loopback or container gateway.' }));
        return;
      }

      res.statusCode = 202;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        status: 'restarting',
        timestamp: new Date().toISOString(),
        message: 'Container restart initiated gracefully.'
      }));

      // Initiate graceful shutdown
      setTimeout(() => {
        try {
          process.kill(process.pid, 'SIGTERM');
        } catch {}
        setTimeout(() => process.exit(0), 1000);
      }, 500);
    }
  });

  // Health check endpoint
  webServer.register({
    kind: 'exact',
    path: '/dsh-dds/health',
    handler: async (req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        user: process.getuid ? process.getuid() : 'unknown',
        uptime: process.uptime()
      }));
    }
  });

  // Authenticated BYOK Vault REST endpoint
  webServer.register({
    kind: 'exact',
    path: '/dsh-dds/api/vault/keys',
    handler: async (req, res) => {
      const vault = (typeof ctx.get === 'function' ? ctx.get('byokVault') : null) || new ByokVault(config);
      const user = req.user || (typeof ctx.get === 'function' ? ctx.get('iam')?.getCurrentUser() : null) || { id: 'default' };
      await handleVaultApiRequest(req, res, vault, user);
    }
  });
}
