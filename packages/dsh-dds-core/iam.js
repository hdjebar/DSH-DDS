/**
 * Identity & Access Management (IAM) Service for @dsh-dds/core
 *
 * Provides request-level identity extraction, token authentication,
 * context enrichment, and graceful fallback for single-operator deployments.
 */

import crypto from 'node:crypto';

export const DEFAULT_OPERATOR = Object.freeze({
  id: 'default',
  name: 'Default Operator',
  roles: ['admin'],
  permissions: ['*']
});

export function sanitizeUserId(userId) {
  if (!userId || typeof userId !== 'string') {
    return 'default';
  }
  const clean = userId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  return clean || 'default';
}

export function verifyBearerToken(token, secret) {
  if (!token || !secret) return false;
  try {
    // Check HMAC-signed format: header.payload.signature
    const parts = token.split('.');
    if (parts.length === 3) {
      const data = `${parts[0]}.${parts[1]}`;
      const expectedSig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
      if (crypto.timingSafeEqual(Buffer.from(parts[2]), Buffer.from(expectedSig))) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        if (payload.exp && Date.now() / 1000 > payload.exp) {
          return false; // Expired
        }
        return payload;
      }
    }
    // Simple bearer secret match fallback
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(secret))
      ? { sub: 'default', roles: ['admin'] }
      : false;
  } catch {
    return false;
  }
}

export function extractUserFromHeaders(headers = {}, options = {}) {
  const authSecret = options.authSecret || process.env.DSH_AUTH_SECRET;
  const authEnabled = options.authEnabled ?? (process.env.DSH_AUTH_ENABLE === 'true');

  const authHeader = headers['authorization'] || headers['Authorization'] || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (authEnabled) {
    if (!bearerToken) {
      return { error: 'UNAUTHORIZED', message: 'Missing Authorization Bearer token' };
    }
    const tokenPayload = verifyBearerToken(bearerToken, authSecret);
    if (!tokenPayload) {
      return { error: 'UNAUTHORIZED', message: 'Invalid or expired Authorization Bearer token' };
    }
    const id = sanitizeUserId(tokenPayload.sub || tokenPayload.id || 'default');
    const roles = Array.isArray(tokenPayload.roles)
      ? tokenPayload.roles
      : (tokenPayload.role ? [tokenPayload.role] : ['user']);
    return {
      id,
      name: tokenPayload.name || id,
      roles,
      permissions: tokenPayload.permissions || ['workspace:read', 'workspace:write']
    };
  }

  // Explicit user identity headers passed by reverse proxy or gateway
  const headerUserId = headers['x-dsh-user-id'];
  if (headerUserId) {
    const id = sanitizeUserId(headerUserId);
    const name = headers['x-dsh-user-name'] || id;
    const rawRoles = headers['x-dsh-user-roles'] || headers['x-dsh-user-role'] || 'user';
    const roles = typeof rawRoles === 'string'
      ? rawRoles.split(',').map(r => r.trim()).filter(Boolean)
      : (Array.isArray(rawRoles) ? rawRoles : ['user']);
    const permissions = roles.includes('admin')
      ? ['*']
      : ['workspace:read', 'workspace:write'];

    return { id, name, roles, permissions };
  }

  // Default fallback for single-operator local mode
  return { ...DEFAULT_OPERATOR };
}

export class IamService {
  constructor(ctx, config = {}) {
    this.ctx = ctx;
    this.config = config;
    this.authEnabled = config.authEnabled ?? (process.env.DSH_AUTH_ENABLE === 'true');
    this.authSecret = config.authSecret || process.env.DSH_AUTH_SECRET || '';
    this.currentUser = { ...DEFAULT_OPERATOR };
  }

  setCurrentUser(user) {
    this.currentUser = Object.freeze({ ...user });
    if (this.ctx) {
      try {
        if (typeof this.ctx.provide === 'function') {
          this.ctx.provide('user', this.currentUser);
        }
      } catch {}
      try {
        this.ctx.user = this.currentUser;
      } catch {}
    }
  }

  getCurrentUser() {
    return this.currentUser;
  }

  authenticateRequest(req) {
    const headers = req?.headers || {};
    const result = extractUserFromHeaders(headers, {
      authEnabled: this.authEnabled,
      authSecret: this.authSecret
    });

    if (result.error) {
      return result;
    }

    if (req) {
      req.user = result;
    }
    this.setCurrentUser(result);
    return result;
  }
}

export function registerIamMiddleware(ctx, config = {}) {
  const iam = new IamService(ctx, config);

  if (typeof ctx.provide === 'function') {
    try { ctx.provide('iam', iam); } catch {}
  }

  const hookWebServer = (webCtx) => {
    try {
      if (webCtx.webServer && typeof webCtx.webServer.use === 'function') {
        webCtx.webServer.use((req, res, next) => {
          const authResult = iam.authenticateRequest(req);
          if (authResult.error) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: authResult.error, message: authResult.message }));
            return;
          }
          if (typeof next === 'function') next();
        });
      }
    } catch {}
  };

  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (webCtx) => hookWebServer(webCtx));
  }

  return iam;
}
