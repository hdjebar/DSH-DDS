/**
 * Identity & Access Management (IAM) Service for @dsh-dds/core
 *
 * Provides request-level identity extraction, token authentication,
 * context enrichment, and graceful fallback for single-operator deployments.
 */

import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { isTrustedGatewayIp } from './net-trust.js';

const PARTITION_ID_VERSION = 'u2';

export const DEFAULT_OPERATOR = Object.freeze({
  id: 'default',
  issuer: 'dsh-local',
  partitionId: deriveUserPartitionId('default', 'dsh-local'),
  name: 'Default Operator',
  roles: Object.freeze(['admin']),
  permissions: Object.freeze(['*'])
});

function requireIdentityValue(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

export function deriveUserPartitionId(userId, issuer = 'dsh-local') {
  const subject = requireIdentityValue(userId, 'User identity');
  const canonicalIssuer = requireIdentityValue(issuer, 'Identity issuer');
  const digest = crypto.createHash('sha256')
    .update(canonicalIssuer, 'utf8')
    .update('\0', 'utf8')
    .update(subject, 'utf8')
    .digest('base64url');
  return `${PARTITION_ID_VERSION}_${digest}`;
}

export function legacyUserPartitionId(userId) {
  if (!userId || typeof userId !== 'string') {
    return 'default';
  }
  const clean = userId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  return clean || 'default';
}

// Backward-compatible export name with secure, versioned semantics.
export const sanitizeUserId = deriveUserPartitionId;

export function freezeUserIdentity(user) {
  if (!user || typeof user !== 'object') {
    throw new Error('Authenticated user identity is required');
  }
  const id = requireIdentityValue(user.id || user.sub, 'User identity');
  const issuer = requireIdentityValue(user.issuer || user.iss || 'dsh-local', 'Identity issuer');
  const roles = Object.freeze([...(Array.isArray(user.roles) ? user.roles : ['user'])]);
  const permissions = Object.freeze([...(Array.isArray(user.permissions)
    ? user.permissions
    : ['workspace:read', 'workspace:write'])]);
  return Object.freeze({
    ...user,
    id,
    issuer,
    partitionId: deriveUserPartitionId(id, issuer),
    roles,
    permissions
  });
}

export function verifyBearerToken(token, secret) {
  if (!token || !secret) return false;
  try {
    // Check HMAC-signed format: header.payload.signature
    const parts = token.split('.');
    if (parts.length === 3) {
      let header;
      try {
        header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      } catch {
        return false;
      }
      // Strictly pin algorithm to HS256 to prevent algorithm confusion attacks
      if (!header || header.alg !== 'HS256') {
        return false;
      }
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
  const trustProxyHeaders = options.trustProxyHeaders ?? (process.env.DSH_TRUST_PROXY_HEADERS === 'true');

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
    if (typeof (tokenPayload.sub || tokenPayload.id) !== 'string' || !(tokenPayload.sub || tokenPayload.id).trim()) {
      return { error: 'UNAUTHORIZED', message: 'Bearer token is missing a stable subject' };
    }
    const id = requireIdentityValue(tokenPayload.sub || tokenPayload.id, 'Token subject');
    const issuer = tokenPayload.iss || options.defaultIssuer || 'dsh-local';
    const roles = Array.isArray(tokenPayload.roles)
      ? tokenPayload.roles
      : (tokenPayload.role ? [tokenPayload.role] : ['user']);
    return freezeUserIdentity({
      id,
      issuer,
      name: tokenPayload.name || id,
      roles,
      permissions: tokenPayload.permissions || ['workspace:read', 'workspace:write']
    });
  }

  // Explicit user identity headers passed by reverse proxy or gateway (requires trusted peer & opt-in)
  const headerUserId = headers['x-dsh-user-id'];
  if (headerUserId && trustProxyHeaders && isTrustedGatewayIp(options.remoteAddress)) {
    const id = requireIdentityValue(headerUserId, 'Gateway user identity');
    const issuer = headers['x-dsh-user-issuer'] || options.defaultIssuer || 'dsh-gateway';
    const name = headers['x-dsh-user-name'] || id;
    const rawRoles = headers['x-dsh-user-roles'] || headers['x-dsh-user-role'] || 'user';
    const roles = typeof rawRoles === 'string'
      ? rawRoles.split(',').map(r => r.trim()).filter(Boolean)
      : (Array.isArray(rawRoles) ? rawRoles : ['user']);
    const permissions = roles.includes('admin')
      ? ['*']
      : ['workspace:read', 'workspace:write'];

    return freezeUserIdentity({ id, issuer, name, roles, permissions });
  }

  // Default fallback for single-operator local mode
  return DEFAULT_OPERATOR;
}

export class IamService {
  constructor(ctx, config = {}) {
    this.ctx = ctx;
    this.config = config;
    this.authEnabled = config.authEnabled ?? (process.env.DSH_AUTH_ENABLE === 'true');
    this.authSecret = config.authSecret || process.env.DSH_AUTH_SECRET || '';
    this.trustProxyHeaders = config.trustProxyHeaders ?? (process.env.DSH_TRUST_PROXY_HEADERS === 'true');
    this.defaultIssuer = config.defaultIssuer || process.env.DSH_IDENTITY_ISSUER || 'dsh-local';
    this.identityContext = new AsyncLocalStorage();
  }

  runWithUser(user, callback) {
    if (typeof callback !== 'function') {
      throw new Error('A request callback is required for identity context');
    }
    return this.identityContext.run(freezeUserIdentity(user), callback);
  }

  getCurrentUser() {
    return this.identityContext.getStore() || (this.authEnabled ? null : DEFAULT_OPERATOR);
  }

  authenticateRequest(req) {
    const headers = req?.headers || {};
    const result = extractUserFromHeaders(headers, {
      authEnabled: this.authEnabled,
      authSecret: this.authSecret,
      trustProxyHeaders: this.trustProxyHeaders,
      defaultIssuer: this.defaultIssuer,
      remoteAddress: req?.socket?.remoteAddress
    });

    if (result.error) {
      return result;
    }

    if (req) {
      req.user = freezeUserIdentity(result);
    }
    return req?.user || freezeUserIdentity(result);
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
          if (typeof next === 'function') {
            return iam.runWithUser(authResult, next);
          }
        });
      }
    } catch {}
  };

  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (webCtx) => hookWebServer(webCtx));
  }

  return iam;
}
