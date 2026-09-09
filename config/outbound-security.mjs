import dns from 'node:dns/promises';
import net from 'node:net';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class OutboundSecurityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OutboundSecurityError';
    this.code = code;
  }
}

export function parseHostAllowlist(value = '') {
  return String(value).split(',')
    .map((host) => host.trim().toLowerCase().replace(/^\[|\]$/g, ''))
    .filter(Boolean);
}

export function parsePortAllowlist(value = '') {
  return String(value).split(',')
    .map((port) => Number(port.trim()))
    .filter((port) => Number.isInteger(port) && port >= 1 && port <= 65535);
}

function hostMatches(hostname, allowedHost) {
  if (allowedHost.startsWith('*.')) {
    const suffix = allowedHost.slice(1);
    return hostname.endsWith(suffix) && hostname.length > suffix.length;
  }
  return hostname === allowedHost;
}

function isBlockedIpv4(address) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

function isBlockedIp(address) {
  const normalized = address.toLowerCase().split('%')[0];
  if (net.isIPv4(normalized)) return isBlockedIpv4(normalized);
  if (!net.isIPv6(normalized)) return true;
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || /^fe[89ab]/.test(normalized)) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isBlockedIpv4(mapped[1]) : false;
}

export async function validateOutboundUrl(input, options = {}) {
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new OutboundSecurityError('OUTBOUND_URL_INVALID', `Invalid outbound URL '${input}'`);
  }
  const protocols = options.protocols || ['https:'];
  if (!protocols.includes(parsed.protocol)) {
    throw new OutboundSecurityError('OUTBOUND_PROTOCOL_DENIED', `Protocol '${parsed.protocol}' is not permitted`);
  }
  if (parsed.username || parsed.password) {
    throw new OutboundSecurityError('OUTBOUND_CREDENTIALS_DENIED', 'Outbound URLs cannot contain credentials');
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const allowedHosts = (options.allowedHosts || []).map((host) => String(host).toLowerCase());
  if (!allowedHosts.some((host) => hostMatches(hostname, host))) {
    throw new OutboundSecurityError('OUTBOUND_HOST_DENIED', `Outbound host '${hostname}' is not allowlisted`);
  }
  if (Array.isArray(options.allowedPorts) && options.allowedPorts.length > 0) {
    const effectivePort = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
    if (!options.allowedPorts.includes(effectivePort)) {
      throw new OutboundSecurityError('OUTBOUND_PORT_DENIED', `Outbound port '${effectivePort}' is not allowlisted`);
    }
  }
  const allowPrivate = (options.allowPrivateHosts || []).map((host) => String(host).toLowerCase())
    .some((host) => hostMatches(hostname, host));
  let addresses;
  if (net.isIP(hostname)) {
    addresses = [{ address: hostname }];
  } else {
    try {
      addresses = await (options.lookup || dns.lookup)(hostname, { all: true, verbatim: true });
    } catch (error) {
      throw new OutboundSecurityError('OUTBOUND_DNS_FAILED', `Could not resolve outbound host '${hostname}': ${error.message}`);
    }
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new OutboundSecurityError('OUTBOUND_DNS_FAILED', `Outbound host '${hostname}' resolved to no addresses`);
  }
  if (!allowPrivate && addresses.some(({ address }) => isBlockedIp(address))) {
    throw new OutboundSecurityError('OUTBOUND_ADDRESS_DENIED', `Outbound host '${hostname}' resolves to a non-public address`);
  }
  return parsed;
}

export async function secureFetch(input, options = {}) {
  const {
    allowedHosts = [], allowPrivateHosts = [], allowedPorts, protocols = ['https:'], timeoutMs = 2000,
    maxRedirects = 3, fetchImpl = globalThis.fetch, lookup, ...fetchOptions
  } = options;
  if (typeof fetchImpl !== 'function') throw new OutboundSecurityError('OUTBOUND_FETCH_UNAVAILABLE', 'Fetch API is unavailable');

  let current = String(input);
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const parsed = await validateOutboundUrl(current, { allowedHosts, allowPrivateHosts, allowedPorts, protocols, lookup });
    const response = await fetchImpl(parsed, { ...fetchOptions, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    if (!REDIRECT_STATUSES.has(response.status)) return response;
    if (redirectCount === maxRedirects) throw new OutboundSecurityError('OUTBOUND_REDIRECT_LIMIT', `Too many redirects fetching '${input}'`);
    const location = response.headers.get('location');
    if (!location) throw new OutboundSecurityError('OUTBOUND_REDIRECT_INVALID', 'Redirect response is missing Location header');
    response.body?.cancel?.().catch?.(() => {});
    current = new URL(location, parsed).toString();
  }
  throw new OutboundSecurityError('OUTBOUND_REDIRECT_LIMIT', `Too many redirects fetching '${input}'`);
}

export async function readResponseBodyLimited(response, maxBytes = 2 * 1024 * 1024) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new OutboundSecurityError('OUTBOUND_RESPONSE_TOO_LARGE', `Response exceeds ${maxBytes} bytes`);
  }
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new OutboundSecurityError('OUTBOUND_RESPONSE_TOO_LARGE', `Response exceeds ${maxBytes} bytes`);
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new OutboundSecurityError('OUTBOUND_RESPONSE_TOO_LARGE', `Response exceeds ${maxBytes} bytes`);
      chunks.push(value);
    }
  } finally {
    if (total > maxBytes) await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
}
