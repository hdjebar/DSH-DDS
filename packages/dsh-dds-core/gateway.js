/**
 * WebServer Gateway & Lifecycle Supervisor Adapter for @dsh-dds/core
 *
 * Replaces ad-hoc disk patches (patch-market-restart.mjs, patch-client-connection.mjs).
 * Native Cordis integration intercepting requests on ctx.webServer.
 */
import { handleVaultApiRequest, ByokVault } from './byok-vault.js';
import { DEFAULT_OPERATOR } from './iam.js';
import { isTrustedGatewayIp, isLoopbackOrLocalBridgeIp } from './net-trust.js';
import crypto from 'node:crypto';

export { isTrustedGatewayIp, isLoopbackOrLocalBridgeIp };

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
      let origin = req.headers.origin || '';
      if (!origin && req.headers.referer) {
        try {
          origin = new URL(req.headers.referer).origin;
        } catch {}
      }
      const host = req.headers.host || '';

      if (!isLoopbackOrLocalBridgeIp(remote) || !isSameOriginOrLoopback(origin, host)) {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Forbidden: Restart request must originate from loopback or container gateway.' }));
        return;
      }

      if (!req.user || !Array.isArray(req.user.roles) || !req.user.roles.includes('admin')) {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Forbidden: Administrator authorization is required.' }));
        return;
      }

      const expectedCsrfToken = config.restartCsrfToken || process.env.DSH_RESTART_CSRF_TOKEN;
      const suppliedCsrfToken = req.headers['x-dsh-csrf-token'];
      if (!expectedCsrfToken || typeof suppliedCsrfToken !== 'string' || suppliedCsrfToken.length !== expectedCsrfToken.length ||
          !crypto.timingSafeEqual(Buffer.from(suppliedCsrfToken), Buffer.from(expectedCsrfToken))) {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Forbidden: Valid restart CSRF token is required.' }));
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
      try {
        const iam = typeof ctx.get === 'function' ? ctx.get('iam') : null;
        const user = req.user || iam?.getCurrentUser?.();
        const authEnabled = config.authEnabled ?? (process.env.DSH_AUTH_ENABLE === 'true');
        if (!user && authEnabled) {
          res.statusCode = 401;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            success: false,
            error: 'UNAUTHORIZED',
            message: 'Authenticated user identity is required'
          }));
          return;
        }
        const vault = (typeof ctx.get === 'function' ? ctx.get('byokVault') : null) || new ByokVault(config);
        if (vault) {
          void vault.userStateBase;
        }
        await handleVaultApiRequest(req, res, vault, user || DEFAULT_OPERATOR);
      } catch (err) {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            success: false,
            error: 'VAULT_UNAVAILABLE',
            message: err.message
          }));
        }
      }
    }
  });
}
