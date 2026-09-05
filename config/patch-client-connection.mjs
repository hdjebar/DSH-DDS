#!/usr/bin/env node

/**
 * Token fence elimination patch for @deepseek-ai/dsh-client-connection.
 * Enables direct access to DSH Web Workbench without requiring ?token=... launch token query param.
 */

import fs from 'node:fs';

const CANDIDATES = [
  process.env.DSH_CLIENT_CONNECTION_FILE,
  '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js',
  '/usr/local/lib/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js'
].filter(Boolean);

const FILE = CANDIDATES.find(p => fs.existsSync(p));

if (!FILE) {
  console.log('ℹ️ dsh-client-connection module not found in candidate paths; skipping.');
  process.exit(0);
}

const realFile = fs.realpathSync(FILE);
let content = fs.readFileSync(realFile, 'utf8');

if (content.includes('// dsh-client-connection token fence bypass applied')) {
  console.log('ℹ️ dsh-client-connection token fence bypass already applied; nothing to do.');
  process.exit(0);
}

const anchorToken = 'if (req.method === "GET" && url.pathname === "/" && tokens.length === 1 && authority !== void 0 && tokenMatches(tokens.join(""), this.launchToken)) {';
if (!content.includes(anchorToken)) {
  console.error('❌ dsh-client-connection anchorToken missing — upstream module changed.');
  process.exit(1);
}

const anchorAuth = '\t\tif (this.isAuthenticated(req)) return true;\n\t\tthis.writeUnauthorized(req, res);\n\t\treturn false;';
if (!content.includes(anchorAuth)) {
  console.error('❌ dsh-client-connection anchorAuth missing — upstream module changed.');
  process.exit(1);
}

const anchorRej = '\trequestRejection(request) {\n\t\tif (!isTrustedApiRequest(request, this.trustedHosts)) return 403;\n\t\treturn this.browserAuth.isAuthenticated(request) ? void 0 : 401;\n\t}';
if (!content.includes(anchorRej)) {
  console.error('❌ dsh-client-connection anchorRej missing — upstream module changed.');
  process.exit(1);
}

// 1. Any token query parameter on GET / issues the session cookie and 303 redirects to clean /
content = content.replace(
  anchorToken,
  'if (req.method === "GET" && url.pathname === "/" && authority !== void 0) {'
);

// 2. Direct GET / without token auto-mints the authority-bound session cookie and serves index.html (HTTP 200)
content = content.replace(
  anchorAuth,
  '\t\tif (this.isAuthenticated(req)) return true;\n\t\tconst authority = requestAuthority(req.headers);\n\t\tif (authority !== void 0) {\n\t\t\tconst issuedAt = Date.now();\n\t\t\tconst expiresAt = issuedAt + this.maxAgeMilliseconds;\n\t\t\tconst value = encodeCookie({\n\t\t\t\tversion: COOKIE_PAYLOAD_VERSION,\n\t\t\t\tauthority,\n\t\t\t\tissuedAt,\n\t\t\t\texpiresAt\n\t\t\t}, this.secret);\n\t\t\tres.setHeader("set-cookie", sessionCookie(cookieName(authority), value, expiresAt, Math.floor(this.maxAgeMilliseconds / 1e3)));\n\t\t}\n\t\treturn true;'
);

// 3. Trusted API requests pass through without 401 token requirement
content = content.replace(
  anchorRej,
  '\trequestRejection(request) {\n\t\tif (!isTrustedApiRequest(request, this.trustedHosts)) return 403;\n\t\treturn void 0;\n\t}'
);

content = '// dsh-client-connection token fence bypass applied\n' + content;

fs.writeFileSync(realFile, content, 'utf8');
console.log('✅ dsh-client-connection token fence bypass patch applied cleanly.');
